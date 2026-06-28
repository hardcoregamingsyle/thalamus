#include "ResearchView.h"
#include <QHBoxLayout>
#include <QSplitter>
#include <QScrollBar>
#include <QTimer>
#include <QDateTime>

ResearchView::ResearchView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_isResearching(false)
{
    setupUI();
}

ResearchView::~ResearchView() {}

void ResearchView::setupUI()
{
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(16, 16, 16, 16);
    mainLayout->setSpacing(12);

    // Header
    auto *header = new QLabel("🔬  Deep Research");
    header->setStyleSheet("font-size: 22px; font-weight: 700; color: #fff;");

    auto *subtitle = new QLabel("Conduct comprehensive multi-source research with AI-powered analysis");
    subtitle->setStyleSheet("font-size: 12px; color: #888;");
    subtitle->setWordWrap(true);

    // Query input area
    auto *inputContainer = new QWidget();
    inputContainer->setStyleSheet("background: #1a1a1a; border-radius: 12px; padding: 16px;");
    auto *inputLayout = new QVBoxLayout(inputContainer);
    inputLayout->setSpacing(8);

    auto *queryLabel = new QLabel("Research Query");
    queryLabel->setStyleSheet("font-size: 12px; font-weight: 600; color: #ccc;");

    m_queryInput = new QTextEdit();
    m_queryInput->setPlaceholderText("e.g., What are the latest breakthroughs in quantum computing as of 2026?");
    m_queryInput->setMaximumHeight(100);
    m_queryInput->setAcceptRichText(false);
    m_queryInput->setStyleSheet(
        "QTextEdit { background: #0d0d0d; border: 1px solid #333; border-radius: 8px;"
        "  padding: 10px; font-size: 13px; color: #e0e0e0; }"
        "QTextEdit:focus { border-color: #a78bfa; }"
    );

    // Controls
    auto *controlsLayout = new QHBoxLayout();
    controlsLayout->setSpacing(8);

    auto *depthLabel = new QLabel("Depth:");
    depthLabel->setStyleSheet("font-size: 11px; color: #888;");

    m_depthCombo = new QComboBox();
    m_depthCombo->addItems({"Quick (1 round)", "Standard (3 rounds)", "Deep (5 rounds)", "Exhaustive (10 rounds)"});
    m_depthCombo->setCurrentIndex(1);
    m_depthCombo->setStyleSheet(
        "QComboBox { background: #0d0d0d; border: 1px solid #333; border-radius: 6px;"
        "  padding: 6px 12px; font-size: 11px; color: #e0e0e0; min-width: 160px; }"
        "QComboBox::drop-down { border: none; }"
        "QComboBox::down-arrow { image: none; }"
        "QComboBox:hover { border-color: #a78bfa; }"
    );

    m_researchBtn = new QPushButton("🔍  Start Research");
    m_researchBtn->setCursor(Qt::PointingHandCursor);
    m_researchBtn->setStyleSheet(
        "QPushButton { background: #a78bfa; color: #fff; border: none; border-radius: 8px;"
        "  padding: 10px 20px; font-size: 13px; font-weight: 600; }"
        "QPushButton:hover { background: #8b6ff0; }"
        "QPushButton:disabled { background: #333; color: #666; }"
    );

    m_clearBtn = new QPushButton("✕  Clear");
    m_clearBtn->setCursor(Qt::PointingHandCursor);
    m_clearBtn->setStyleSheet(
        "QPushButton { background: transparent; color: #888; border: 1px solid #333; border-radius: 8px;"
        "  padding: 10px 16px; font-size: 12px; }"
        "QPushButton:hover { color: #ccc; border-color: #555; }"
    );

    controlsLayout->addWidget(depthLabel);
    controlsLayout->addWidget(m_depthCombo);
    controlsLayout->addStretch();
    controlsLayout->addWidget(m_clearBtn);
    controlsLayout->addWidget(m_researchBtn);

    inputLayout->addWidget(queryLabel);
    inputLayout->addWidget(m_queryInput);
    inputLayout->addLayout(controlsLayout);

    // Progress bar
    m_progressBar = new QProgressBar();
    m_progressBar->setVisible(false);
    m_progressBar->setRange(0, 0); // Indeterminate
    m_progressBar->setStyleSheet(
        "QProgressBar { background: #1a1a1a; border: none; border-radius: 4px; height: 6px; text-align: center; font-size: 10px; color: transparent; }"
        "QProgressBar::chunk { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #a78bfa, stop:1 #51cf66); border-radius: 4px; }"
    );

    // Results area
    m_resultScroll = new QScrollArea();
    m_resultScroll->setWidgetResizable(true);
    m_resultScroll->setStyleSheet("QScrollArea { background: transparent; border: none; }");

    m_resultContainer = new QWidget();
    m_resultLayout = new QVBoxLayout(m_resultContainer);
    m_resultLayout->setContentsMargins(0, 0, 0, 0);
    m_resultLayout->setSpacing(16);

    auto *placeholder = new QLabel("Enter a research query above and click \"Start Research\"");
    placeholder->setAlignment(Qt::AlignCenter);
    placeholder->setStyleSheet("font-size: 13px; color: #555; padding: 60px;");
    m_resultLayout->addWidget(placeholder);

    m_resultScroll->setWidget(m_resultContainer);

    // Status
    m_statusLabel = new QLabel();
    m_statusLabel->setStyleSheet("font-size: 11px; color: #666;");

    // Assemble
    mainLayout->addWidget(header);
    mainLayout->addWidget(subtitle);
    mainLayout->addWidget(inputContainer);
    mainLayout->addWidget(m_progressBar);
    mainLayout->addWidget(m_resultScroll, 1);
    mainLayout->addWidget(m_statusLabel);

    // Connections
    connect(m_researchBtn, &QPushButton::clicked, this, &ResearchView::onStartResearch);
    connect(m_clearBtn, &QPushButton::clicked, this, &ResearchView::onClearResearch);
}

void ResearchView::onStartResearch()
{
    QString query = m_queryInput->toPlainText().trimmed();
    if (query.isEmpty() || m_isResearching) return;

    m_isResearching = true;
    m_researchBtn->setEnabled(false);
    m_progressBar->setVisible(true);
    m_statusLabel->setText("Researching...");

    // Clear previous results and store query for callback
    m_researchQuery = query;
    m_currentResearchResponse.clear();
    onClearResearch();

    QString depthLabel = m_depthCombo->currentText();

    QString systemPrompt = QString(
        "You are a deep research assistant. Conduct thorough research on the following query. "
        "Investigate from multiple angles, find supporting evidence, consider counterarguments, "
        "and provide a comprehensive, well-structured report with citations where possible.\n\n"
        "Research depth: %1\n"
        "Current date: %2"
    ).arg(depthLabel, QDateTime::currentDateTime().toString("MMMM d, yyyy"));

    // Send via streaming chat with "research" mode
    QJsonArray history;

    m_client->streamChat(
        query,
        "research",
        history,
        systemPrompt,
        "",
        m_client->authToken(),
        [this](const QString &chunk) {
            if (!chunk.isEmpty()) {
                m_currentResearchResponse += chunk;
            }
        },
        [this](const QString &text, bool success) {
            m_isResearching = false;
            m_researchBtn->setEnabled(true);
            m_progressBar->setVisible(false);

            if (success && !text.isEmpty()) {
                appendResult("Research Report: " + m_researchQuery, text);
                m_statusLabel->setText("Research complete");
            } else {
                m_statusLabel->setText("Research failed. Please try again.");
            }
        }
    );
}

void ResearchView::appendResult(const QString &title, const QString &content)
{
    auto *resultWidget = new QWidget();
    resultWidget->setStyleSheet("background: #1a1a1a; border-radius: 12px; padding: 16px;");
    auto *layout = new QVBoxLayout(resultWidget);
    layout->setContentsMargins(16, 12, 16, 12);
    layout->setSpacing(8);

    auto *titleLabel = new QLabel(title);
    titleLabel->setStyleSheet("font-size: 15px; font-weight: 700; color: #a78bfa;");
    titleLabel->setWordWrap(true);

    auto *contentLabel = new QLabel(m_mdRenderer->renderToHtml(content));
    contentLabel->setTextFormat(Qt::RichText);
    contentLabel->setWordWrap(true);
    contentLabel->setMinimumWidth(400);
    contentLabel->setStyleSheet("font-size: 13px; color: #e0e0e0;");

    layout->addWidget(titleLabel);
    layout->addWidget(contentLabel);

    // Remove placeholder if exists
    if (m_resultLayout->count() == 1) {
        QLayoutItem *item = m_resultLayout->takeAt(0);
        if (item->widget()) item->widget()->deleteLater();
        delete item;
    }

    m_resultLayout->addWidget(resultWidget);

    QTimer::singleShot(50, this, [this]() {
        m_resultScroll->verticalScrollBar()->setValue(
            m_resultScroll->verticalScrollBar()->maximum()
        );
    });
}

void ResearchView::onClearResearch()
{
    while (m_resultLayout->count() > 0) {
        QLayoutItem *item = m_resultLayout->takeAt(0);
        if (item->widget()) delete item->widget();
        delete item;
    }

    auto *placeholder = new QLabel("Enter a research query above and click \"Start Research\"");
    placeholder->setAlignment(Qt::AlignCenter);
    placeholder->setStyleSheet("font-size: 13px; color: #555; padding: 60px;");
    m_resultLayout->addWidget(placeholder);
}
