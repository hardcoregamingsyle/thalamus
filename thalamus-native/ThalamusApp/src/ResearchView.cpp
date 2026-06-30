// Thalamus AI — ResearchView.cpp
#include "ResearchView.h"
#include "ConvexClient.h"
#include "MarkdownRenderer.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QScrollBar>
#include <QHeaderView>

ResearchView::ResearchView(ConvexClient *client, QWidget *parent)
    : QWidget(parent), m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this)), m_isResearching(false)
{ setupUi(); }

void ResearchView::setupUi()
{
    auto *l = new QVBoxLayout(this); l->setSpacing(8); l->setContentsMargins(16,16,16,16);
    auto *h = new QLabel("Deep Research");
    h->setStyleSheet("font-size:18px; font-weight:bold; color:#c0c0f0;");
    l->addWidget(h);
    auto *d = new QLabel("Research a topic in depth with multi-source citations.");
    d->setWordWrap(true); d->setStyleSheet("color:#8080a0; font-size:13px; margin-bottom:8px;");
    l->addWidget(d);

    auto *il = new QHBoxLayout;
    m_queryInput = new QLineEdit;
    m_queryInput->setPlaceholderText("Enter a research topic...");
    m_queryInput->setStyleSheet(
        "QLineEdit { padding:12px; border:1px solid #3e3e5e; border-radius:8px; "
        "background:#16162a; color:#e0e0f0; font-size:14px; }"
        "QLineEdit:focus { border-color:#6e6eff; }");
    connect(m_queryInput, &QLineEdit::returnPressed, this, &ResearchView::onStartResearch);
    il->addWidget(m_queryInput, 1);
    m_startButton = new QPushButton("Research");
    m_startButton->setCursor(Qt::PointingHandCursor);
    m_startButton->setStyleSheet(
        "QPushButton { padding:10px 24px; border:none; border-radius:8px; "
        "background:#4a4aff; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#5a5aff; }");
    connect(m_startButton, &QPushButton::clicked, this, &ResearchView::onStartResearch);
    il->addWidget(m_startButton);
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

    m_progressBar = new QProgressBar;
    m_progressBar->setRange(0,0);
    m_progressBar->setStyleSheet(
        "QProgressBar { border:none; border-radius:4px; background:#1e1e32; height:6px; }"
        "QProgressBar::chunk { background:#4a4aff; border-radius:4px; }");
    m_progressBar->hide();
    l->addWidget(m_progressBar);

    auto *sp = new QSplitter(Qt::Horizontal, this);
    m_sourcesTree = new QTreeWidget;
    m_sourcesTree->setHeaderLabels({"Source","Relevance"});
    m_sourcesTree->setStyleSheet(
        "QTreeWidget { background:#16162a; border:1px solid #2e2e4e; border-radius:6px; "
        "color:#c0c0e0; font-size:13px; }"
        "QTreeWidget::item { padding:4px 8px; }"
        "QTreeWidget::item:selected { background:#2a2a4a; }"
        "QHeaderView::section { background:#1e1e32; color:#8080a0; padding:4px; "
        "border:none; border-bottom:1px solid #2e2e4e; }");
    m_sourcesTree->setMinimumWidth(200);
    m_sourcesTree->header()->setStretchLastSection(true);
    sp->addWidget(m_sourcesTree);

    m_resultDisplay = new QTextEdit;
    m_resultDisplay->setReadOnly(true);
    m_resultDisplay->setStyleSheet(
        "QTextEdit { background:#16162a; border:1px solid #2e2e4e; border-radius:6px; "
        "padding:16px; color:#d0d0e8; font-size:14px; }");
    sp->addWidget(m_resultDisplay);
    l->addWidget(sp, 1);
}

void ResearchView::onStartResearch()
{
    QString q = m_queryInput->text().trimmed();
    if (q.isEmpty()) return;
    m_resultDisplay->clear(); m_sourcesTree->clear(); m_currentResult.clear();
    setInputEnabled(false); m_isResearching = true; m_progressBar->show();
    m_client->startChatStream(q, "research",
        [this](const QString &c) { onStreamChunk(c); },
        [this]() { onStreamDone(); });
}

void ResearchView::onStreamChunk(const QString &text)
{
    m_currentResult += text;
    m_resultDisplay->setHtml(m_mdRenderer->render(m_currentResult));
    QScrollBar *sb = m_resultDisplay->verticalScrollBar();
    if (sb) sb->setValue(sb->maximum());
}

void ResearchView::onStreamDone()
{
    m_isResearching = false; setInputEnabled(true); m_progressBar->hide();
}

void ResearchView::setInputEnabled(bool en)
{
    m_queryInput->setEnabled(en); m_startButton->setVisible(en);
    m_stopButton->setVisible(!en);
    if (en) m_queryInput->setFocus();
}
