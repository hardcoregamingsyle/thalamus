/**
 * Thalamus AI — Chat View
 * Streaming AI chat with Convex backend.
 * Displays AI responses as rich HTML.
 */

#include "ChatView.h"
#include "ConvexClient.h"

#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QScrollArea>
#include <QTextBrowser>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QScrollBar>
#include <QJsonDocument>
#include <QJsonObject>

static const QString CHAT_SYSTEM_PROMPT =
    "You are Thalamus AI, an advanced AI assistant by Aphantic Corporations. "
    "Be helpful, accurate, and concise. Use rich formatting.";

ChatView::ChatView(ConvexClient *client, QWidget *parent)
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
    newConversation();
}

void ChatView::setupUi() {
    m_mainLayout->setContentsMargins(0, 0, 0, 0);
    m_mainLayout->setSpacing(0);

    // Messages area
    m_scrollArea->setWidgetResizable(true);
    m_scrollArea->setWidget(m_messagesContainer);
    m_scrollArea->setFrameShape(QFrame::NoFrame);
    m_scrollArea->setStyleSheet("QScrollArea { background: #0d1117; }");

    m_messagesLayout->setContentsMargins(16, 16, 16, 16);
    m_messagesLayout->setSpacing(12);
    m_messagesLayout->addStretch();

    m_mainLayout->addWidget(m_scrollArea, 1);

    // Status label
    m_statusLabel->setStyleSheet("color: #9ca3af; font-size: 11px; padding: 4px 16px;");
    m_statusLabel->hide();
    m_mainLayout->addWidget(m_statusLabel);

    // Input area
    auto *inputBar = new QWidget(this);
    inputBar->setStyleSheet("QWidget { background: #0d1117; border-top: 1px solid #1f2937; }");
    auto *inputLayout = new QHBoxLayout(inputBar);
    inputLayout->setContentsMargins(16, 12, 16, 16);

    m_input->setPlaceholderText("Ask Thalamus AI anything...");
    m_input->setStyleSheet(
        "QLineEdit { padding: 12px 16px; border: 1px solid #374151; border-radius: 12px; "
        "background: #111827; color: #e5e7eb; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6366f1; }");
    inputLayout->addWidget(m_input, 1);

    m_sendBtn->setFixedSize(44, 44);
    m_sendBtn->setStyleSheet(
        "QPushButton { background: #6366f1; color: white; border: none; border-radius: 12px; "
        "font-size: 18px; font-weight: bold; }"
        "QPushButton:hover { background: #818cf8; }"
        "QPushButton:disabled { background: #374151; color: #6b7280; }");
    inputLayout->addWidget(m_sendBtn);

    m_mainLayout->addWidget(inputBar);

    // Connections
    connect(m_sendBtn, &QPushButton::clicked, this, &ChatView::onSendClicked);
    connect(m_input, &QLineEdit::returnPressed, this, &ChatView::onSendClicked);
    connect(m_client, &ConvexClient::streamThinking, this, &ChatView::onStreamThinking);
    connect(m_client, &ConvexClient::streamAnswerStart, this, &ChatView::onStreamAnswerStart);
    connect(m_client, &ConvexClient::streamChunk, this, &ChatView::onStreamChunk);
    connect(m_client, &ConvexClient::streamDone, this, &ChatView::onStreamDone);
    connect(m_client, &ConvexClient::streamError, this, &ChatView::onStreamError);
}

void ChatView::newConversation() {
    // Clear all messages
    QLayoutItem *item;
    while ((item = m_messagesLayout->takeAt(0)) != nullptr) {
        if (item->widget()) item->widget()->deleteLater();
        delete item;
    }
    m_messagesLayout->addStretch();
    m_history = QJsonArray();
    m_conversationId.clear();
    m_currentResponse.clear();
    m_currentAssistant = nullptr;

    // Welcome message
    appendMessage("assistant",
        "<div style='padding: 20px; text-align: center;'>"
        "<h1 style='color: #f9fafb; font-size: 24px;'>🧠 Thalamus AI</h1>"
        "<p style='color: #9ca3af; font-size: 14px; margin-top: 8px;'>"
        "Your AI-powered research, coding, and study companion.</p>"
        "<p style='color: #6b7280; font-size: 12px; margin-top: 4px;'>"
        "Ask me anything to get started.</p>"
        "</div>");
}

void ChatView::sendMessage(const QString &text) {
    if (text.trimmed().isEmpty() || m_streaming) return;

    m_streaming = true;
    m_input->setEnabled(false);
    m_sendBtn->setEnabled(false);
    m_statusLabel->setText("Thinking...");
    m_statusLabel->show();

    appendMessage("user", QString("<div style='color: #e5e7eb;'>%1</div>").arg(text.toHtmlEscaped()));

    m_history.append(QJsonObject{{"role", "user"}, {"content", text}});

    m_client->streamChat(text, "chat", m_history, CHAT_SYSTEM_PROMPT, m_conversationId);
}

void ChatView::appendMessage(const QString &role, const QString &html) {
    auto *msgWidget = new QWidget();
    auto *msgLayout = new QVBoxLayout(msgWidget);
    msgLayout->setContentsMargins(0, 0, 0, 0);

    auto *browser = new QTextBrowser();
    browser->setOpenExternalLinks(true);
    browser->setFrameShape(QFrame::NoFrame);
    browser->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    browser->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    browser->document()->setDefaultStyleSheet(
        "body { font-family: 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; }"
        "h1, h2, h3 { color: #f9fafb; }"
        "p { color: #d1d5db; }"
        "code { background: #1f2937; color: #34d399; padding: 2px 6px; border-radius: 4px; font-family: monospace; }"
        "pre { background: #111827; color: #34d399; padding: 12px; border-radius: 8px; overflow-x: auto; }"
        "pre code { background: none; padding: 0; }"
        "a { color: #60a5fa; }"
        "blockquote { border-left: 3px solid #374151; padding-left: 12px; color: #9ca3af; }"
        "ul, ol { margin: 4px 0; padding-left: 20px; color: #d1d5db; }"
        "li { margin: 2px 0; }"
    );

    if (role == "assistant") {
        msgWidget->setStyleSheet("background: #0d1117;");
        m_currentAssistant = browser;
    } else {
        msgWidget->setStyleSheet("background: #0d1117;");
    }

    browser->setHtml(html);
    msgLayout->addWidget(browser);

    // Insert before the stretch
    int count = m_messagesLayout->count();
    m_messagesLayout->insertWidget(count - 1, msgWidget);
}

void ChatView::scrollToBottom() {
    QScrollBar *sb = m_scrollArea->verticalScrollBar();
    sb->setValue(sb->maximum());
}

void ChatView::onSendClicked() {
    QString text = m_input->text().trimmed();
    if (!text.isEmpty()) {
        m_input->clear();
        sendMessage(text);
    }
}

void ChatView::onStreamThinking(const QString &chunk) {
    m_statusLabel->setText(chunk.trimmed());
}

void ChatView::onStreamAnswerStart() {
    m_currentResponse.clear();
    appendMessage("assistant", "<div style='color: #d1d5db;'></div>");
}

void ChatView::onStreamChunk(const QString &chunk) {
    m_currentResponse += chunk;
    if (m_currentAssistant) {
        m_currentAssistant->setHtml(
            QString("<div style='color: #d1d5db;'>%1</div>").arg(m_currentResponse));
        scrollToBottom();
    }
}

void ChatView::onStreamDone(const QString &fullText) {
    m_currentResponse = fullText;
    m_history.append(QJsonObject{{"role", "assistant"}, {"content", fullText}});

    m_streaming = false;
    m_input->setEnabled(true);
    m_sendBtn->setEnabled(true);
    m_statusLabel->hide();
    scrollToBottom();
}

void ChatView::onStreamError(const QString &error) {
    m_streaming = false;
    m_input->setEnabled(true);
    m_sendBtn->setEnabled(true);
    m_statusLabel->setText("Error: " + error);
    m_statusLabel->setStyleSheet("color: #ef4444; font-size: 11px; padding: 4px 16px;");
    m_statusLabel->show();
}
