/**
 * Thalamus AI — Research View
 * Deep multi-source AI-powered research mode.
 * Structured reports with tables, citations, and analysis.
 */

#include "ResearchView.h"
#include "ConvexClient.h"

#include <QScrollArea>
#include <QScrollBar>
#include <QLabel>
#include <QJsonDocument>
#include <QJsonObject>

static const QString RESEARCH_SYSTEM_PROMPT =
    "You are Thalamus AI Research Mode — a deep research assistant by Aphantic Corporations. "
    "Structure research reports with clear headings, analysis paragraphs, findings, comparisons in tables, "
    "key insights in blockquotes, and technical examples in code blocks. Be comprehensive and cite reasoning.";

ResearchView::ResearchView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mainLayout(new QVBoxLayout(this))
    , m_scrollArea(new QScrollArea(this))
    , m_messagesContainer(new QWidget())
    , m_messagesLayout(new QVBoxLayout(m_messagesContainer))
    , m_input(new QLineEdit(this))
    , m_sendBtn(new QPushButton("→", this))
    , m_statusLabel(new QLabel(this))
    , m_currentAssistant(nullptr)
    , m_streaming(false)
{
    setupUi();

    // Welcome message
    appendMessage("assistant",
        "<div style='padding: 20px; text-align: center;'>"
        "<h1 style='color: #f9fafb; font-size: 24px;'>🔬 Research Mode</h1>"
        "<p style='color: #9ca3af; font-size: 14px; margin-top: 8px;'>"
        "Deep, structured research on any topic.</p>"
        "<p style='color: #6b7280; font-size: 12px; margin-top: 4px;'>"
        "Enter a topic or question to begin a thorough analysis.</p>"
        "</div>");
}

void ResearchView::setupUi() {
    m_mainLayout->setContentsMargins(0, 0, 0, 0);
    m_mainLayout->setSpacing(0);

    m_scrollArea->setWidgetResizable(true);
    m_scrollArea->setWidget(m_messagesContainer);
    m_scrollArea->setFrameShape(QFrame::NoFrame);
    m_scrollArea->setStyleSheet("QScrollArea { background: #0d1117; }");

    m_messagesLayout->setContentsMargins(16, 16, 16, 16);
    m_messagesLayout->setSpacing(12);
    m_messagesLayout->addStretch();

    m_mainLayout->addWidget(m_scrollArea, 1);

    m_statusLabel->setStyleSheet("color: #9ca3af; font-size: 11px; padding: 4px 16px;");
    m_statusLabel->hide();
    m_mainLayout->addWidget(m_statusLabel);

    auto *inputBar = new QWidget(this);
    inputBar->setStyleSheet("QWidget { background: #0d1117; border-top: 1px solid #1f2937; }");
    auto *inputLayout = new QHBoxLayout(inputBar);
    inputLayout->setContentsMargins(16, 12, 16, 16);

    m_input->setPlaceholderText("What would you like to research?");
    m_input->setStyleSheet(
        "QLineEdit { padding: 12px 16px; border: 1px solid #374151; border-radius: 12px; "
        "background: #111827; color: #e5e7eb; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6366f1; }");
    inputLayout->addWidget(m_input, 1);

    m_sendBtn->setFixedSize(44, 44);
    m_sendBtn->setStyleSheet(
        "QPushButton { background: #6366f1; color: white; border: none; border-radius: 12px; "
        "font-size: 18px; font-weight: bold; }"
        "QPushButton:hover { background: #818cf8; }");
    inputLayout->addWidget(m_sendBtn);

    m_mainLayout->addWidget(inputBar);

    connect(m_sendBtn, &QPushButton::clicked, this, &ResearchView::onSendClicked);
    connect(m_input, &QLineEdit::returnPressed, this, &ResearchView::onSendClicked);
    connect(m_client, &ConvexClient::streamChunk, this, &ResearchView::onStreamChunk);
    connect(m_client, &ConvexClient::streamDone, this, &ResearchView::onStreamDone);
    connect(m_client, &ConvexClient::streamError, this, &ResearchView::onStreamError);
}

void ResearchView::onSendClicked() {
    QString text = m_input->text().trimmed();
    if (!text.isEmpty() && !m_streaming) {
        m_input->clear();
        startResearch(text);
    }
}

void ResearchView::startResearch(const QString &topic) {
    m_streaming = true;
    m_input->setEnabled(false);
    m_sendBtn->setEnabled(false);
    m_statusLabel->setText("🔬 Researching...");
    m_statusLabel->show();

    appendMessage("user", QString("<div style='color: #e5e7eb;'>%1</div>").arg(topic.toHtmlEscaped()));
    m_history.append(QJsonObject{{"role", "user"}, {"content", topic}});

    m_client->streamChat(topic, "research", m_history, RESEARCH_SYSTEM_PROMPT);
}

void ResearchView::appendMessage(const QString &role, const QString &html) {
    auto *msgWidget = new QWidget();
    auto *msgLayout = new QVBoxLayout(msgWidget);
    msgLayout->setContentsMargins(0, 0, 0, 0);

    auto *browser = new QTextBrowser();
    browser->setOpenExternalLinks(true);
    browser->setFrameShape(QFrame::NoFrame);
    browser->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    browser->document()->setDefaultStyleSheet(
        "body { font-family: 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.7; }"
        "h1, h2, h3 { color: #f9fafb; }"
        "p { color: #d1d5db; }"
        "code { background: #1f2937; color: #34d399; padding: 2px 6px; border-radius: 4px; font-family: monospace; }"
        "pre { background: #111827; color: #34d399; padding: 12px; border-radius: 8px; }"
        "a { color: #60a5fa; }"
        "blockquote { border-left: 3px solid #6366f1; padding-left: 12px; color: #c4b5fd; }"
        "ul, ol { margin: 4px 0; padding-left: 20px; color: #d1d5db; }"
    );

    if (role == "assistant") m_currentAssistant = browser;

    browser->setHtml(html);
    msgLayout->addWidget(browser);

    int count = m_messagesLayout->count();
    m_messagesLayout->insertWidget(count - 1, msgWidget);
}

void ResearchView::scrollToBottom() {
    QScrollBar *sb = m_scrollArea->verticalScrollBar();
    sb->setValue(sb->maximum());
}

void ResearchView::onStreamChunk(const QString &chunk) {
    m_currentResponse += chunk;
    if (m_currentAssistant) {
        m_currentAssistant->setHtml(
            QString("<div style='color: #d1d5db;'>%1</div>").arg(m_currentResponse));
        scrollToBottom();
    }
}

void ResearchView::onStreamDone(const QString &fullText) {
    m_currentResponse = fullText;
    m_history.append(QJsonObject{{"role", "assistant"}, {"content", fullText}});
    m_streaming = false;
    m_input->setEnabled(true);
    m_sendBtn->setEnabled(true);
    m_statusLabel->hide();
    scrollToBottom();
}

void ResearchView::onStreamError(const QString &error) {
    m_streaming = false;
    m_input->setEnabled(true);
    m_sendBtn->setEnabled(true);
    m_statusLabel->setText("Error: " + error);
    m_statusLabel->setStyleSheet("color: #ef4444; font-size: 11px;");
    m_statusLabel->show();
}
