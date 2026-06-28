#ifndef CHATVIEW_H
#define CHATVIEW_H

#include <QWidget>
#include <QVBoxLayout>
#include <QTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QLabel>
#include <QJsonArray>
#include <QJsonObject>
#include "ConvexClient.h"
#include "MarkdownRenderer.h"

/**
 * @brief Chat mode UI — send messages, receive streaming AI responses.
 */
class ChatView : public QWidget
{
    Q_OBJECT

public:
    explicit ChatView(ConvexClient *client, QWidget *parent = nullptr);
    ~ChatView();

    void setConversationId(const QString &id) { m_conversationId = id; }
    QString conversationId() const { return m_conversationId; }

signals:
    void conversationSelected(const QString &id);

private slots:
    void onSendMessage();
    void onNewConversation();
    void onConversationsLoaded(const QJsonArray &convs);
    void onConversationCreated(const QJsonObject &conv);
    void onMessagesLoaded(const QJsonArray &messages);

private:
    void setupUI();
    void appendMessage(const QString &role, const QString &content);
    void appendAssistantChunk(const QString &chunk);
    void clearChat();
    void loadConversations();
    void switchConversation(const QString &id);
    QString formatTimestamp();

    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;

    // UI
    QWidget *m_sidebar;
    QListWidget *m_conversationList;
    QWidget *m_chatArea;
    QScrollArea *m_messageScroll;
    QWidget *m_messageContainer;
    QVBoxLayout *m_messageLayout;
    QTextEdit *m_inputEdit;
    QPushButton *m_sendBtn;
    QPushButton *m_newBtn;
    QLabel *m_modeLabel;
    QLabel *m_statusLabel;

    // State
    QString m_currentMode;
    QString m_conversationId;
    QJsonArray m_history;
    QList<QPair<QString, QString>> m_messages; // role, content
    bool m_isReceiving;
    QString m_currentResponse;
};

#endif // CHATVIEW_H
