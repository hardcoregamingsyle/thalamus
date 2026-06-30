#ifndef CHATVIEW_H
#define CHATVIEW_H

#include <QWidget>
#include <QTextBrowser>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QScrollArea>

class ConvexClient;

class ChatView : public QWidget {
    Q_OBJECT

public:
    explicit ChatView(ConvexClient *client, QWidget *parent = nullptr);

    void newConversation();
    void sendMessage(const QString &text);

private slots:
    void onSendClicked();
    void onStreamThinking(const QString &chunk);
    void onStreamAnswerStart();
    void onStreamChunk(const QString &chunk);
    void onStreamDone(const QString &fullText);
    void onStreamError(const QString &error);

private:
    void setupUi();
    void appendMessage(const QString &role, const QString &html);
    void scrollToBottom();

    ConvexClient *m_client;
    QVBoxLayout *m_mainLayout;
    QScrollArea *m_scrollArea;
    QWidget *m_messagesContainer;
    QVBoxLayout *m_messagesLayout;
    QLineEdit *m_input;
    QPushButton *m_sendBtn;
    QLabel *m_statusLabel;
    QTextBrowser *m_currentAssistant;

    QJsonArray m_history;
    QString m_currentResponse;
    QString m_conversationId;
    bool m_streaming;
};

#endif // CHATVIEW_H
