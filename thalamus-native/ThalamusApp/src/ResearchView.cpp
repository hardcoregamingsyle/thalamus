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
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_isResearching(false)
{
    setupUi();
}

void ResearchView::setupUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(8);
    layout->setContentsMargins(16, 16, 16, 16);

    // Header
    auto *header = new QLabel("Deep Research");
    header->setStyleSheet("font-size: 18px; font-weight: bold; color: #c0c0f0;");
    layout->addWidget(header);

    auto *description = new QLabel(
        "Research a topic in depth. The AI will search multiple sources and "
        "produce a comprehensive report with citations.");
    description->setWordWrap(true);
    description->setStyleSheet("color: #8080a0; font-size: 13px; margin-bottom: 8px;");
    layout->addWidget(description);

    // Query input
    auto *inputLayout = new QHBoxLayout;
    m_queryInput = new QLineEdit;
    m_queryInput->setPlaceholderText("Enter a research topic...");
    m_queryInput->setStyleSheet(
        "QLineEdit { padding: 12px; border: 1px solid #3e3e5e; border-radius: 8px; "
        "background: #16162a; color: #e0e0f0; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6e6eff; }"
    );
    connect(m_queryInput, &QLineEdit::returnPressed, this, &ResearchView::onStartResearch);
    inputLayout->addWidget(m_queryInput, 1);

    m_startButton = new QPushButton("Research");
    m_startButton->setCursor(Qt::PointingHandCursor);
    m_startButton->setStyleSheet(
        "QPushButton { padding: 10px 24px; border: none; border-radius: 8px; "
        "background: #4a4aff; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #5a5aff; }"
        "QPushButton:disabled { background: #2a2a4a; color: #606080; }"
    );
    connect(m_startButton, &QPushButton::clicked, this, &ResearchView::onStartResearch);
    inputLayout->addWidget(m_startButton);

    m_stopButton = new QPushButton("Stop");
    m_stopButton->setCursor(Qt::PointingHandCursor);
    m_stopButton->setStyleSheet(
        "QPushButton { padding: 10px 24px; border: none; border-radius: 8px; "
        "background: #ff4a4a; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #ff5a5a; }"
    );
    m_stopButton->hide();
    connect(m_stopButton, &QPushButton::clicked, this, [this]() {
        m_client->cancelStream();
        onStreamDone();
    });
    inputLayout->addWidget(m_stopButton);

    layout->addLayout(inputLayout);

    // Progress bar
    m_progressBar = new QProgressBar;
    m_progressBar->setRange(0, 0); // indeterminate
    m_progressBar->setStyleSheet(
        "QProgressBar { border: none; border-radius: 4px; background: #1e1e32; height: 6px; }"
        "QProgressBar::chunk { background: #4a4aff; border-radius: 4px; }"
    );
    m_progressBar->hide();
    layout->addWidget(m_progressBar);

    // Splitter: Sources tree + Result
    auto *splitter = new QSplitter(Qt::Horizontal, this);

    m_sourcesTree = new QTreeWidget;
    m_sourcesTree->setHeaderLabels({"Source", "Relevance"});
    m_sourcesTree->setStyleSheet(
        "QTreeWidget { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "color: #c0c0e0; font-size: 13px; }"
        "QTreeWidget::item { padding: 4px 8px; }"
        "QTreeWidget::item:selected { background: #2a2a4a; }"
        "QHeaderView::section { background: #1e1e32; color: #8080a0; padding: 4px; "
        "border: none; border-bottom: 1px solid #2e2e4e; }"
    );
    m_sourcesTree->setMinimumWidth(200);
    m_sourcesTree->header()->setStretchLastSection(true);
    splitter->addWidget(m_sourcesTree);

    m_resultDisplay = new QTextEdit;
    m_resultDisplay->setReadOnly(true);
    m_resultDisplay->setStyleSheet(
        "QTextEdit { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "padding: 16px; color: #d0d0e8; font-size: 14px; }"
    );
    splitter->addWidget(m_resultDisplay);

    layout->addWidget(splitter, 1);
}

void ResearchView::onStartResearch()
{
    QString query = m_queryInput->text().trimmed();
    if (query.isEmpty()) return;

    m_resultDisplay->clear();
    m_sourcesTree->clear();
    m_currentResult.clear();

    setInputEnabled(false);
    m_isResearching = true;
    m_progressBar->show();

    m_client->startChatStream(
        query, "research",
        [this](const QString &chunk) { onStreamChunk(chunk); },
        [this]() { onStreamDone(); }
    );
}

void ResearchView::onStreamChunk(const QString &text)
{
    m_currentResult += text;
    m_resultDisplay->setHtml(m_mdRenderer->render(m_currentResult));

    QScrollBar *scrollBar = m_resultDisplay->verticalScrollBar();
    if (scrollBar) scrollBar->setValue(scrollBar->maximum());
}

void ResearchView::onStreamDone()
{
    m_isResearching = false;
    setInputEnabled(true);
    m_progressBar->hide();
}

void ResearchView::setInputEnabled(bool enabled)
{
    m_queryInput->setEnabled(enabled);
    m_startButton->setVisible(enabled);
    m_stopButton->setVisible(!enabled);
    if (enabled) m_queryInput->setFocus();
}
