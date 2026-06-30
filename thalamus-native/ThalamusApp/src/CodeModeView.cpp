// Thalamus AI — CodeModeView.cpp
#include "CodeModeView.h"
#include "ConvexClient.h"
#include "MarkdownRenderer.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QScrollBar>
#include <QHeaderView>
#include <QDateTime>

CodeModeView::CodeModeView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_isRunning(false)
{
    setupUi();
}

void CodeModeView::setupUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(8);
    layout->setContentsMargins(16, 16, 16, 16);

    auto *header = new QLabel("Code Mode");
    header->setStyleSheet("font-size: 18px; font-weight: bold; color: #c0c0f0;");
    layout->addWidget(header);

    auto *description = new QLabel(
        "Describe a coding task and the 9-agent autonomous pipeline "
        "(Researcher \u2192 Analyser \u2192 Planner \u2192 Coder \u2192 Optimiser \u2192 "
        "Organiser \u2192 Tester \u2192 Hacker \u2192 Critic) will build it.");
    description->setWordWrap(true);
    description->setStyleSheet("color: #8080a0; font-size: 13px; margin-bottom: 8px;");
    layout->addWidget(description);

    // Splitter: agent tree + output
    auto *splitter = new QSplitter(Qt::Horizontal, this);

    auto *agentContainer = new QWidget;
    auto *agentLayout = new QVBoxLayout(agentContainer);
    agentLayout->setContentsMargins(0, 0, 0, 0);
    agentLayout->setSpacing(4);

    auto *agentHeader = new QLabel("Pipeline Agents");
    agentHeader->setStyleSheet("color: #a0a0c0; font-size: 13px; font-weight: bold;");
    agentLayout->addWidget(agentHeader);

    m_agentTree = new QTreeWidget;
    m_agentTree->setHeaderLabels({"Agent", "Status"});
    m_agentTree->setColumnWidth(0, 140);
    m_agentTree->setStyleSheet(
        "QTreeWidget { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "color: #c0c0e0; font-size: 12px; }"
        "QTreeWidget::item { padding: 6px 8px; }"
        "QHeaderView::section { background: #1e1e32; color: #8080a0; padding: 4px; "
        "border: none; border-bottom: 1px solid #2e2e4e; }");

    // Populate agent pipeline
    QStringList agents = {"Researcher", "Analyser", "Planner", "Coder",
                          "Optimiser", "Organiser", "Tester", "Hacker", "Critic"};
    for (const QString &name : agents) {
        auto *item = new QTreeWidgetItem(m_agentTree);
        item->setText(0, name);
        item->setText(1, "Waiting");
        item->setForeground(1, QColor("#606080"));
    }
    agentLayout->addWidget(m_agentTree, 1);
    agentContainer->setMinimumWidth(200);
    splitter->addWidget(agentContainer);

    m_outputDisplay = new QTextEdit;
    m_outputDisplay->setReadOnly(true);
    m_outputDisplay->setStyleSheet(
        "QTextEdit { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "padding: 16px; color: #d0d0e8; font-size: 13px; }");
    splitter->addWidget(m_outputDisplay);
    layout->addWidget(splitter, 1);

    // Status label
    m_statusLabel = new QLabel("Ready");
    m_statusLabel->setStyleSheet("color: #606080; font-size: 12px;");
    layout->addWidget(m_statusLabel);

    // Input area
    auto *inputLayout = new QHBoxLayout;
    m_promptInput = new QLineEdit;
    m_promptInput->setPlaceholderText("Describe the coding task...");
    m_promptInput->setStyleSheet(
        "QLineEdit { padding: 12px; border: 1px solid #3e3e5e; border-radius: 8px; "
        "background: #16162a; color: #e0e0f0; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6e6eff; }");
    connect(m_promptInput, &QLineEdit::returnPressed, this, &CodeModeView::onExecutePrompt);
    inputLayout->addWidget(m_promptInput, 1);

    m_executeButton = new QPushButton("Execute");
    m_executeButton->setCursor(Qt::PointingHandCursor);
    m_executeButton->setStyleSheet(
        "QPushButton { padding: 10px 24px; border: none; border-radius: 8px; "
        "background: #4a4aff; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #5a5aff; }"
        "QPushButton:disabled { background: #2a2a4a; color: #606080; }");
    connect(m_executeButton, &QPushButton::clicked, this, &CodeModeView::onExecutePrompt);
    inputLayout->addWidget(m_executeButton);

    m_stopButton = new QPushButton("Stop");
    m_stopButton->setCursor(Qt::PointingHandCursor);
    m_stopButton->setStyleSheet(
        "QPushButton { padding: 10px 24px; border: none; border-radius: 8px; "
        "background: #ff4a4a; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #ff5a5a; }");
    m_stopButton->hide();
    connect(m_stopButton, &QPushButton::clicked, this, [this]() {
        m_client->cancelStream();
        onStreamDone();
    });
    inputLayout->addWidget(m_stopButton);
    layout->addLayout(inputLayout);
}

void CodeModeView::onExecutePrompt()
{
    QString prompt = m_promptInput->text().trimmed();
    if (prompt.isEmpty()) return;

    m_outputDisplay->clear();
    m_currentOutput.clear();
    setInputEnabled(false);
    m_isRunning = true;
    m_statusLabel->setText("Pipeline running...");

    // Reset agent statuses
    for (int i = 0; i < m_agentTree->topLevelItemCount(); ++i) {
        auto *item = m_agentTree->topLevelItem(i);
        item->setText(1, "Waiting");
        item->setForeground(1, QColor("#606080"));
    }

    // Mark first agent as active
    if (m_agentTree->topLevelItemCount() > 0) {
        m_agentTree->topLevelItem(0)->setText(1, "Running...");
        m_agentTree->topLevelItem(0)->setForeground(1, QColor("#4a4aff"));
    }

    m_client->startChatStream(prompt, "code",
        [this](const QString &chunk) { onStreamChunk(chunk); },
        [this]() { onStreamDone(); });
}

void CodeModeView::onStreamChunk(const QString &text)
{
    m_currentOutput += text;

    // Parse agent markers from stream (e.g., "## Researcher:" ...)
    // Simple heuristic: detect agent names at start of lines
    static const QStringList agents = {"Researcher", "Analyser", "Planner", "Coder",
                                       "Optimiser", "Organiser", "Tester", "Hacker", "Critic"};
    for (int i = 0; i < agents.size(); ++i) {
        QString marker = "## " + agents[i];
        if (m_currentOutput.contains(marker)) {
            // Mark this agent as completed
            auto *item = m_agentTree->topLevelItem(i);
            if (item) {
                item->setText(1, "Complete");
                item->setForeground(1, QColor("#4aaf4a"));
            }
            // Mark next agent as running
            if (i + 1 < m_agentTree->topLevelItemCount()) {
                auto *next = m_agentTree->topLevelItem(i + 1);
                if (next && next->text(1) == "Waiting") {
                    next->setText(1, "Running...");
                    next->setForeground(1, QColor("#4a4aff"));
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
    m_isRunning = false;
    setInputEnabled(true);
    m_statusLabel->setText("Pipeline complete");

    // Mark all remaining agents as complete
    for (int i = 0; i < m_agentTree->topLevelItemCount(); ++i) {
        auto *item = m_agentTree->topLevelItem(i);
        if (item->text(1) == "Running..." || item->text(1) == "Waiting") {
            item->setText(1, "Complete");
            item->setForeground(1, QColor("#4aaf4a"));
        }
    }
}

void CodeModeView::setInputEnabled(bool enabled)
{
    m_promptInput->setEnabled(enabled);
    m_executeButton->setVisible(enabled);
    m_stopButton->setVisible(!enabled);
    if (enabled) m_promptInput->setFocus();
}
