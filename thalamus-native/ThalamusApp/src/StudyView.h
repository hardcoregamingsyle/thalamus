#ifndef STUDYVIEW_H
#define STUDYVIEW_H

#include <QWidget>
#include <QTextBrowser>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>
#include <QJsonArray>

class ConvexClient;

class StudyView : public QWidget {
    Q_OBJECT

public:
    explicit StudyView(ConvexClient *client, QWidget *parent = nullptr);

private slots:
    void onSendClicked();
    void onStreamChunk(const QString &chunk);
    void onStreamDone(const QString &fullText);
    void onStreamError(const QString &error);

private:
    void setupUi();
    void startStudy(const QString &question);
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

#endif // STUDYVIEW_H
