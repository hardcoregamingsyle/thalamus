// Thalamus AI — ChatView.cpp
#include "ChatView.h"
#include "ConvexClient.h"
#include "MarkdownRenderer.h"
#include <QScrollBar>
#include <QDateTime>
#include <QHBoxLayout>

ChatView::ChatView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_isStreaming(false)
{
    setupUi();
}

void ChatView::setupUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(0);
    layout->setContentsMargins(0, 0, 0, 0);

    // Header
    auto *headerLabel = new QLabel("Chat");
    headerLabel->setStyleSheet(
        "font-size: 18px; font-weight: bold; color: #c0c0f0; padding: 16px 20px 8px;");
    layout->addWidget(headerLabel);

    // Chat display area
    m_chatDisplay = new QTextEdit(this);
    m_chatDisplay->setReadOnly(true);
    m_chatDisplay->setVerticalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    m_chatDisplay->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    m_chatDisplay->setStyleSheet(
        "QTextEdit { background: #16162a; border: none; padding: 16px; "
        "color: #d0d0e8; font-size: 14px; }"
    );
    m_chatDisplay->document()->setDefaultStyleSheet(
        "p { margin: 4px 0; }"
        "pre { background: #1a1a2e; border: 1px solid #2e2e4e; border-radius: 6px; "
        "padding: 12px; font-size: 13px; }"
        "code { background: #1a1a2e; padding: 2px 6px; border-radius: 3px; font-size: 13px; }"
        "h1, h2, h3 { color: #c0c0f0; }"
        "a { color: #6e6eff; }"
    );
    layout->addWidget(m_chatDisplay, 1);

    // Welcome message
    appendMessage("assistant",
        "<p style='color:#8080a0; font-size:15px;'>Hello! I'm Thalamus AI. "
        "Ask me anything — I can help with coding, research, analysis, and more.</p>");

    // Input area
    auto *inputContainer = new QWidget(this);
    inputContainer->setStyleSheet("background: #1e1e2e; padding: 8px;");
    auto *inputLayout = new QHBoxLayout(inputContainer);
    inputLayout->setSpacing(8);
    inputLayout->setContentsMargins(12, 8, 12, 8);

    m_messageInput = new QLineEdit;
    m_messageInput->setPlaceholderText("Type your message...");
    m_messageInput->setStyleSheet(
        "QLineEdit { padding: 12px; border: 1px solid #3e3e5e; border-radius: 8px; "
        "background: #16162a; color: #e0e0f0; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6e6eff; }"
    );
    connect(m_messageInput, &QLineEdit::returnPressed, this, &ChatView::onSendClicked);
    inputLayout->addWidget(m_messageInput, 1);

    m_sendButton = new QPushButton("Send");
    m_sendButton->setCursor(Qt::PointingHandCursor);
    m_sendButton->setStyleSheet(
        "QPushButton { padding: 10px 20px; border: none; border-radius: 8px; "
        "background: #4a4aff; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #5a5aff; }"
        "QPushButton:disabled { background: #2a2a4a; color: #606080; }"
    );
    connect(m_sendButton, &QPushButton::clicked, this, &ChatView::onSendClicked);
    inputLayout->addWidget(m_sendButton);

    m_stopButton = new QPushButton("Stop");
    m_stopButton->setCursor(Qt::PointingHandCursor);
    m_stopButton->setStyleSheet(
        "QPushButton { padding: 10px 20px; border: none; border-radius: 8px; "
        "background: #ff4a4a; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #ff5a5a; }"
    );
    m_stopButton->hide();
    connect(m_stopButton, &QPushButton::clicked, this, [this]() {
        m_client->cancelStream();
        onStreamDone();
    });
    inputLayout->addWidget(m_stopButton);

    layout->addWidget(inputContainer);
}

void ChatView::onSendClicked()
{
    QString message = m_messageInput->text().trimmed();
    if (message.isEmpty()) return;

    sendMessage(message);
}

void ChatView::sendMessage(const QString &message)
{
    // Display user message
    appendMessage("user", QString("<p><b>You:</b> %1</p>").arg(message.toHtmlEscaped()));

    m_messageInput->clear();
    setInputEnabled(false);
    m_isStreaming = true;
    m_currentAssistantMessage.clear();

    m_client->startChatStream(
        message, "chat",
        [this](const QString &chunk) { onStreamChunk(chunk); },
        [this]() { onStreamDone(); }
    );
}

void ChatView::onStreamChunk(const QString &text)
{
    m_currentAssistantMessage += text;

    // Render as markdown
    QString html = m_mdRenderer->render(m_currentAssistantMessage);

    // Update the last message in the chat display
    // For simplicity, we'll re-render the entire chat
    // A more efficient approach would maintain messages and update the last one
    QTextCursor cursor = m_chatDisplay->textCursor();
    cursor.movePosition(QTextCursor::End);

    // Simple: append text chunks
    cursor.insertHtml(text.toHtmlEscaped());

    // Auto-scroll
    QScrollBar *scrollBar = m_chatDisplay->verticalScrollBar();
    if (scrollBar) {
        scrollBar->setValue(scrollBar->maximum());
    }
}

void ChatView::onStreamDone()
{
    m_isStreaming = false;
    setInputEnabled(true);
    m_chatDisplay->append("");
}

void ChatView::appendMessage(const QString &role, const QString &html)
{
    m_chatDisplay->append(html);
    QScrollBar *scrollBar = m_chatDisplay->verticalScrollBar();
    if (scrollBar) {
        scrollBar->setValue(scrollBar->maximum());
    }
}

void ChatView::setInputEnabled(bool enabled)
{
    m_messageInput->setEnabled(enabled);
    m_sendButton->setVisible(enabled);
    m_stopButton->setVisible(!enabled);
    if (enabled) {
        m_messageInput->setFocus();
    }
}
