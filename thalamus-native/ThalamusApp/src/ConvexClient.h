#ifndef CONVEXCLIENT_H
#define CONVEXCLIENT_H

#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QTimer>
#include <QJsonObject>
#include <QJsonArray>

class ConvexClient : public QObject {
    Q_OBJECT

public:
    explicit ConvexClient(QObject *parent = nullptr);

    void setBackendUrl(const QString &url);
    QString backendUrl() const;

    void setAuthToken(const QString &token);
    QString authToken() const;

    // Chat with SSE streaming
    void streamChat(const QString &content,
                    const QString &mode,
                    const QJsonArray &history,
                    const QString &systemPrompt,
                    const QString &conversationId = QString());

    // Non-streaming guest chat
    void guestChat(const QString &content,
                   const QString &mode,
                   const QJsonArray &history);

    // Generate conversation title
    void generateTitle(const QString &firstMessage, const QString &conversationId);

    bool isAuthenticated() const;
    bool isStreaming() const;

signals:
    void streamThinking(const QString &chunk);
    void streamAnswerStart();
    void streamChunk(const QString &chunk);
    void streamDone(const QString &fullText);
    void streamError(const QString &error);
    void chatComplete(const QString &response);
    void chatError(const QString &error);
    void titleGenerated(const QString &title);
    void authStateChanged(bool authenticated);

private slots:
    void onStreamReadyRead();
    void onStreamFinished();
    void onReplyFinished(QNetworkReply *reply);

private:
    QNetworkRequest buildRequest(const QString &path, bool json = true) const;
    void parseSSELine(const QString &line);

    QNetworkAccessManager *m_nam;
    QNetworkReply *m_streamReply;
    QString m_backendUrl;
    QString m_authToken;
    QString m_streamBuffer;
    bool m_streaming;
};

#endif // CONVEXCLIENT_H
