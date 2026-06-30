// Thalamus AI — CodeModeView.cpp
#include "CodeModeView.h"
#include "ConvexClient.h"
#include "MarkdownRenderer.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QScrollBar>
#include <QHeaderView>

CodeModeView::CodeModeView(ConvexClient *client, QWidget *parent)
    : QWidget(parent), m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this)), m_isRunning(false)
{ setupUi(); }

void CodeModeView::setupUi()
{
    auto *l = new QVBoxLayout(this); l->setSpacing(8); l->setContentsMargins(16,16,16,16);
    auto *h = new QLabel("Code Mode");
    h->setStyleSheet("font-size:18px; font-weight:bold; color:#c0c0f0;");
    l->addWidget(h);
    auto *d = new QLabel("Describe a task: 9-agent pipeline (Researcher->Analyser->Planner->Coder->Optimiser->Organiser->Tester->Hacker->Critic).");
    d->setWordWrap(true); d->setStyleSheet("color:#8080a0; font-size:13px; margin-bottom:8px;");
    l->addWidget(d);

    auto *sp = new QSplitter(Qt::Horizontal, this);
    auto *ac = new QWidget;
    auto *al = new QVBoxLayout(ac); al->setContentsMargins(0,0,0,0); al->setSpacing(4);
    auto *ah = new QLabel("Pipeline Agents");
    ah->setStyleSheet("color:#a0a0c0; font-size:13px; font-weight:bold;");
    al->addWidget(ah);

    m_agentTree = new QTreeWidget;
    m_agentTree->setHeaderLabels({"Agent","Status"});
    m_agentTree->setColumnWidth(0, 140);
    m_agentTree->setStyleSheet(
        "QTreeWidget { background:#16162a; border:1px solid #2e2e4e; border-radius:6px; "
        "color:#c0c0e0; font-size:12px; }"
        "QTreeWidget::item { padding:6px 8px; }"
        "QHeaderView::section { background:#1e1e32; color:#8080a0; padding:4px; "
        "border:none; border-bottom:1px solid #2e2e4e; }");
    QStringList agents = {"Researcher","Analyser","Planner","Coder",
        "Optimiser","Organiser","Tester","Hacker","Critic"};
    for (const QString &n : agents) {
        auto *item = new QTreeWidgetItem(m_agentTree);
        item->setText(0, n); item->setText(1, "Waiting"); item->setForeground(1, QColor("#606080"));
    }
    al->addWidget(m_agentTree, 1);
    ac->setMinimumWidth(200); sp->addWidget(ac);

    m_outputDisplay = new QTextEdit;
    m_outputDisplay->setReadOnly(true);
    m_outputDisplay->setStyleSheet(
        "QTextEdit { background:#16162a; border:1px solid #2e2e4e; border-radius:6px; "
        "padding:16px; color:#d0d0e8; font-size:13px; }");
    sp->addWidget(m_outputDisplay);
    l->addWidget(sp, 1);

    m_statusLabel = new QLabel("Ready");
    m_statusLabel->setStyleSheet("color:#606080; font-size:12px;");
    l->addWidget(m_statusLabel);

    auto *il = new QHBoxLayout;
    m_promptInput = new QLineEdit;
    m_promptInput->setPlaceholderText("Describe the coding task...");
    m_promptInput->setStyleSheet(
        "QLineEdit { padding:12px; border:1px solid #3e3e5e; border-radius:8px; "
        "background:#16162a; color:#e0e0f0; font-size:14px; }"
        "QLineEdit:focus { border-color:#6e6eff; }");
    connect(m_promptInput, &QLineEdit::returnPressed, this, &CodeModeView::onExecutePrompt);
    il->addWidget(m_promptInput, 1);

    m_executeButton = new QPushButton("Execute");
    m_executeButton->setCursor(Qt::PointingHandCursor);
    m_executeButton->setStyleSheet(
        "QPushButton { padding:10px 24px; border:none; border-radius:8px; "
        "background:#4a4aff; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#5a5aff; }");
    connect(m_executeButton, &QPushButton::clicked, this, &CodeModeView::onExecutePrompt);
    il->addWidget(m_executeButton);

    m_stopButton = new QPushButton("Stop");
    m_stopButton->setCursor(Qt::PointingHandCursor);
    m_stopButton->setStyleSheet(
        "QPushButton { padding:10px 24px; border:none; border-radius:8px; "
        "background:#ff4a4a; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#ff5a5a; }");
    m_stopButton->hide();
    connect(m_stopButton, &QPushButton::clicked, this, [this]() { m_client->cancelStream(); onStreamDone(); });
    il->addWidget(m_stopButton);
    l->addLayout(il);
}

void CodeModeView::onExecutePrompt()
{
    QString p = m_promptInput->text().trimmed();
    if (p.isEmpty()) return;
    m_outputDisplay->clear(); m_currentOutput.clear();
    setInputEnabled(false); m_isRunning = true; m_statusLabel->setText("Pipeline running...");
    for (int i = 0; i < m_agentTree->topLevelItemCount(); ++i) {
        auto *item = m_agentTree->topLevelItem(i);
        item->setText(1, "Waiting"); item->setForeground(1, QColor("#606080"));
    }
    if (m_agentTree->topLevelItemCount() > 0) {
        m_agentTree->topLevelItem(0)->setText(1, "Running...");
        m_agentTree->topLevelItem(0)->setForeground(1, QColor("#4a4aff"));
    }
    m_client->startChatStream(p, "code",
        [this](const QString &c) { onStreamChunk(c); },
        [this]() { onStreamDone(); });
}

void CodeModeView::onStreamChunk(const QString &text)
{
    m_currentOutput += text;
    QStringList agents = {"Researcher","Analyser","Planner","Coder",
        "Optimiser","Organiser","Tester","Hacker","Critic"};
    for (int i = 0; i < agents.size(); ++i) {
        if (m_currentOutput.contains("## " + agents[i])) {
            auto *item = m_agentTree->topLevelItem(i);
            if (item) { item->setText(1, "Complete"); item->setForeground(1, QColor("#4aaf4a")); }
            if (i+1 < m_agentTree->topLevelItemCount()) {
                auto *next = m_agentTree->topLevelItem(i+1);
                if (next && next->text(1) == "Waiting") {
                    next->setText(1, "Running..."); next->setForeground(1, QColor("#4a4aff"));
                }
            }
        }
    }
    m_outputDisplay->setHtml(m_mdRenderer->render(m_currentOutput));
    QScrollBar *sb = m_outputDisplay->verticalScrollBar();
    if (sb) sb->setValue(sb->maximum());
}

void CodeModeView::onStreamDone()
{
    m_isRunning = false; setInputEnabled(true); m_statusLabel->setText("Pipeline complete");
    for (int i = 0; i < m_agentTree->topLevelItemCount(); ++i) {
        auto *item = m_agentTree->topLevelItem(i);
        if (item->text(1) == "Running..." || item->text(1) == "Waiting") {
            item->setText(1, "Complete"); item->setForeground(1, QColor("#4aaf4a"));
        }
    }
}

void CodeModeView::setInputEnabled(bool en)
{
    m_promptInput->setEnabled(en); m_executeButton->setVisible(en);
    m_stopButton->setVisible(!en);
    if (en) m_promptInput->setFocus();
}
