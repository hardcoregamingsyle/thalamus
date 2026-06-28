#include "ChatView.h"
#include <QSplitter>
#include <QHBoxLayout>
#include <QScrollBar>
#include <QTimer>
#include <QDateTime>
#include <QApplication>
#include <QClipboard>
#include <QKeyEvent>

ChatView::ChatView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_currentMode("chat")
    , m_isReceiving(false)
{
    setupUI();

    connect(m_client, &ConvexClient::conversationsLoaded, this, &ChatView::onConversationsLoaded);
    connect(m_client, &ConvexClient::conversationCreated, this, &ChatView::onConversationCreated);
    connect(m_client, &ConvexClient::messagesLoaded, this, &ChatView::onMessagesLoaded);
}

ChatView::~ChatView() {}

void ChatView::setupUI()
{
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    auto *splitter = new QSplitter(Qt::Horizontal, this);

    // ── Sidebar: conversation list ─────────────────────────────────────────
    m_sidebar = new QWidget();
    auto *sidebarLayout = new QVBoxLayout(m_sidebar);
    sidebarLayout->setContentsMargins(8, 8, 8, 8);
    sidebarLayout->setSpacing(8);

    m_modeLabel = new QLabel("💬  Chat");
    m_modeLabel->setStyleSheet("font-size: 16px; font-weight: 700; color: #fff; padding: 8px;");

    m_newBtn = new QPushButton("+ New Conversation");
    m_newBtn->setCursor(Qt::PointingHandCursor);
    m_newBtn->setStyleSheet(
        "QPushButton { background: #a78bfa; color: #fff; border: none; border-radius: 8px;"
        "  padding: 10px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #8b6ff0; }"
    );

    m_conversationList = new QListWidget();
    m_conversationList->setStyleSheet(
        "QListWidget { background: transparent; border: none; }"
        "QListWidget::item { padding: 10px; border-radius: 8px; margin: 2px 0; font-size: 12px; }"
        "QListWidget::item:selected { background: #a78bfa22; color: #a78bfa; }"
        "QListWidget::item:hover { background: #1a1a1a; }"
    );

    sidebarLayout->addWidget(m_modeLabel);
    sidebarLayout->addWidget(m_newBtn);
    sidebarLayout->addWidget(m_conversationList);

    // ── Chat area ──────────────────────────────────────────────────────────
    m_chatArea = new QWidget();
    auto *chatLayout = new QVBoxLayout(m_chatArea);
    chatLayout->setContentsMargins(0, 0, 0, 0);
    chatLayout->setSpacing(0);

    // Messages scroll area
    m_messageScroll = new QScrollArea();
    m_messageScroll->setWidgetResizable(true);
    m_messageScroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    m_messageScroll->setStyleSheet("QScrollArea { background: #111; border: none; }");

    m_messageContainer = new QWidget();
    m_messageLayout = new QVBoxLayout(m_messageContainer);
    m_messageLayout->setContentsMargins(16, 16, 16, 16);
    m_messageLayout->setSpacing(12);
    m_messageLayout->addStretch();

    m_messageScroll->setWidget(m_messageContainer);

    // Input area
    auto *inputLayout = new QHBoxLayout();
    inputLayout->setContentsMargins(12, 8, 12, 12);
    inputLayout->setSpacing(8);

    m_inputEdit = new QTextEdit();
    m_inputEdit->setPlaceholderText("Type a message... (Enter to send, Shift+Enter for new line)");
    m_inputEdit->setMaximumHeight(80);
    m_inputEdit->setAcceptRichText(false);
    m_inputEdit->setStyleSheet(
        "QTextEdit { background: #1a1a1a; border: 1px solid #333; border-radius: 12px;"
        "  padding: 12px; font-size: 13px; color: #e0e0e0; }"
        "QTextEdit:focus { border-color: #a78bfa; }"
    );

    m_sendBtn = new QPushButton("➤");
    m_sendBtn->setFixedSize(44, 44);
    m_sendBtn->setCursor(Qt::PointingHandCursor);
    m_sendBtn->setStyleSheet(
        "QPushButton { background: #a78bfa; color: #fff; border: none; border-radius: 22px; font-size: 18px; }"
        "QPushButton:hover { background: #8b6ff0; }"
        "QPushButton:disabled { background: #333; color: #555; }"
    );
    m_sendBtn->setEnabled(false);

    m_statusLabel = new QLabel();
    m_statusLabel->setStyleSheet("font-size: 11px; color: #666; padding: 0 8px;");

    inputLayout->addWidget(m_inputEdit);
    inputLayout->addWidget(m_sendBtn);
    chatLayout->addWidget(m_messageScroll);
    chatLayout->addWidget(m_statusLabel);
    chatLayout->addLayout(inputLayout);

    splitter->addWidget(m_sidebar);
    splitter->addWidget(m_chatArea);
    splitter->setStretchFactor(0, 1);
    splitter->setStretchFactor(1, 3);
    splitter->setSizes({280, 800});

    mainLayout->addWidget(splitter);

    // ── Connections ────────────────────────────────────────────────────────
    connect(m_sendBtn, &QPushButton::clicked, this, &ChatView::onSendMessage);
    connect(m_newBtn, &QPushButton::clicked, this, &ChatView::onNewConversation);
    connect(m_inputEdit, &QTextEdit::textChanged, this, [this]() {
        m_sendBtn->setEnabled(!m_inputEdit->toPlainText().trimmed().isEmpty());
    });

    // Install event filter on the input for Enter key handling
    m_inputEdit->installEventFilter(this);

    connect(m_conversationList, &QListWidget::currentRowChanged, this, [this](int row) {
        if (row >= 0) {
            QListWidgetItem *item = m_conversationList->item(row);
            switchConversation(item->data(Qt::UserRole).toString());
        }
    });

    connect(m_client, &ConvexClient::queryResult, this, [this](const QJsonValue &result) {
        Q_UNUSED(result);
        // Handle query results routed to the right handler
    });
}

bool ChatView::eventFilter(QObject *obj, QEvent *event)
{
    if (obj == m_inputEdit && event->type() == QEvent::KeyPress) {
        QKeyEvent *keyEvent = static_cast<QKeyEvent *>(event);
        if (keyEvent->key() == Qt::Key_Return || keyEvent->key() == Qt::Key_Enter) {
            if (!(keyEvent->modifiers() & Qt::ShiftModifier)) {
                onSendMessage();
                return true;
            }
        }
    }
    return QWidget::eventFilter(obj, event);
}

void ChatView::onSendMessage()
{
    if (!m_client->isAuthenticated()) {
        m_statusLabel->setText("Please sign in first");
        return;
    }

    QString content = m_inputEdit->toPlainText().trimmed();
    if (content.isEmpty() || m_isReceiving) return;

    m_inputEdit->clear();
    m_sendBtn->setEnabled(false);
    m_statusLabel->setText("Thinking...");

    appendMessage("user", content);
    m_history.append(QJsonObject{{"role", "user"}, {"content", content}});
    m_isReceiving = true;
    m_currentResponse.clear();

    m_client->streamChat(
        content,
        m_currentMode,
        m_history,
        "You are Thalamus AI, a helpful AI assistant. Be concise and accurate.",
        m_conversationId,
        m_client->authToken(),
        [this](const QString &chunk) {
            if (!chunk.isEmpty()) {
                m_currentResponse += chunk;
                appendAssistantChunk(chunk);
            }
        },
        [this](const QString &fullText, bool success) {
            m_isReceiving = false;
            m_sendBtn->setEnabled(true);
            m_statusLabel->setText(success ? "Response complete" : "Error generating response");
            if (success && !fullText.isEmpty()) {
                m_currentResponse = fullText;
                m_history.append(QJsonObject{{"role", "assistant"}, {"content", fullText}});
            }
        }
    );
}

void ChatView::appendMessage(const QString &role, const QString &content)
{
    QString prefix = (role == "user") ? "👤  You" : "🤖  Thalamus";
    QString color = (role == "user") ? "#a78bfa" : "#51cf66";
    QString align = (role == "user") ? "right" : "left";

    auto *msgWidget = new QWidget();
    msgWidget->setStyleSheet(QString("background: %1; border-radius: 12px; padding: 12px;")
                             .arg(role == "user" ? "#1a1a1a" : "#0d0d0d"));

    auto *layout = new QVBoxLayout(msgWidget);
    layout->setContentsMargins(12, 8, 12, 8);
    layout->setSpacing(6);

    auto *header = new QLabel(QString("<span style='font-size:11px; font-weight:600; color:%1;'>%2</span>"
                                      " <span style='font-size:10px; color:#555;'>%3</span>")
                              .arg(color, prefix, formatTimestamp()));
    header->setTextFormat(Qt::RichText);

    auto *contentLabel = new QLabel(m_mdRenderer->renderToHtml(content));
    contentLabel->setTextFormat(Qt::RichText);
    contentLabel->setWordWrap(true);
    contentLabel->setStyleSheet("font-size: 13px; color: #e0e0e0; background: transparent;");
    contentLabel->setMinimumWidth(200);
    contentLabel->setMaximumWidth(700);

    auto *hLayout = new QHBoxLayout();
    if (role == "user") hLayout->addStretch();
    hLayout->addWidget(contentLabel);
    if (role != "user") hLayout->addStretch();

    layout->addWidget(header);
    layout->addLayout(hLayout);

    // Insert before stretch
    m_messageLayout->insertWidget(m_messageLayout->count() - 1, msgWidget);

    // Scroll to bottom
    QTimer::singleShot(50, this, [this]() {
        m_messageScroll->verticalScrollBar()->setValue(
            m_messageScroll->verticalScrollBar()->maximum()
        );
    });
}

void ChatView::appendAssistantChunk(const QString &chunk)
{
    // If this is the first chunk, clear any placeholder and begin a new assistant message
    if (m_currentResponse.isEmpty() && chunk.isEmpty()) return;

    m_messages.append({"assistant", chunk});
    // Scroll to bottom
    QTimer::singleShot(10, this, [this]() {
        m_messageScroll->verticalScrollBar()->setValue(
            m_messageScroll->verticalScrollBar()->maximum()
        );
    });
}

void ChatView::clearChat()
{
    // Remove all message widgets except spacer
    while (m_messageLayout->count() > 1) {
        QLayoutItem *item = m_messageLayout->takeAt(0);
        if (item->widget()) delete item->widget();
        delete item;
    }
    m_history = QJsonArray();
    m_messages.clear();
    m_currentResponse.clear();
    m_conversationId.clear();
}

void ChatView::onNewConversation()
{
    clearChat();
    m_conversationId.clear();
    m_statusLabel->setText("New conversation");
}

void ChatView::loadConversations()
{
    m_client->listConversations(m_currentMode);
}

void ChatView::switchConversation(const QString &id)
{
    m_conversationId = id;
    clearChat();
    m_client->getConversationMessages(id);
}

void ChatView::onConversationsLoaded(const QJsonArray &convs)
{
    m_conversationList->clear();
    for (const QJsonValue &val : convs) {
        QJsonObject conv = val.toObject();
        auto *item = new QListWidgetItem(conv["title"].toString());
        item->setData(Qt::UserRole, conv["_id"].toString());
        m_conversationList->addItem(item);
    }
}

void ChatView::onConversationCreated(const QJsonObject &conv)
{
    m_conversationId = conv["_id"].toString();
    // Add to list
    auto *item = new QListWidgetItem(conv["title"].toString());
    item->setData(Qt::UserRole, m_conversationId);
    m_conversationList->insertItem(0, item);
    m_conversationList->setCurrentRow(0);
}

void ChatView::onMessagesLoaded(const QJsonArray &messages)
{
    for (const QJsonValue &val : messages) {
        QJsonObject msg = val.toObject();
        appendMessage(msg["role"].toString(), msg["content"].toString());
        m_history.append(QJsonObject{
            {"role", msg["role"]},
            {"content", msg["content"]}
        });
    }
}

QString ChatView::formatTimestamp()
{
    return QDateTime::currentDateTime().toString("h:mm AP");
}
