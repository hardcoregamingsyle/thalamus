#ifndef RESEARCHVIEW_H
#define RESEARCHVIEW_H

#include <QWidget>
#include <QTextBrowser>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>
#include <QJsonArray>

class ConvexClient;

class ResearchView : public QWidget {
    Q_OBJECT

public:
    explicit ResearchView(ConvexClient *client, QWidget *parent = nullptr);

private slots:
    void onSendClicked();
    void onStreamChunk(const QString &chunk);
    void onStreamDone(const QString &fullText);
    void onStreamError(const QString &error);

private:
    void setupUi();
    void startResearch(const QString &topic);
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
    bool m_streaming;
};

#endif // RESEARCHVIEW_H
