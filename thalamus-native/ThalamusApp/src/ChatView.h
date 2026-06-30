// Thalamus AI — ChatView.h
#pragma once

#include <QWidget>
#include <QTextEdit>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>
#include <QScrollArea>

class ConvexClient;
class MarkdownRenderer;

class ChatView : public QWidget
{
    Q_OBJECT

public:
    explicit ChatView(ConvexClient *client, QWidget *parent = nullptr);
    ~ChatView() = default;

    void sendMessage(const QString &message);

private slots:
    void onSendClicked();
    void onStreamChunk(const QString &text);
    void onStreamDone();

private:
    void setupUi();
    void appendMessage(const QString &role, const QString &html);
    void setInputEnabled(bool enabled);

    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;

    QTextEdit *m_chatDisplay;
    QLineEdit *m_messageInput;
    QPushButton *m_sendButton;
    QPushButton *m_stopButton;

    bool m_isStreaming;
    QString m_currentAssistantMessage;
};
