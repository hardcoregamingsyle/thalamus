// Thalamus AI — ConvexClient.h
#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QJsonObject>
#include <QJsonArray>
#include <QWebSocket>
#include <QUrl>
#include <functional>

class ConvexClient : public QObject
{
    Q_OBJECT

public:
    explicit ConvexClient(QObject *parent = nullptr);
    ~ConvexClient();

    void setBaseUrl(const QString &url);
    QString baseUrl() const;

    // Auth
    void sendEmailOtp(const QString &email);
    void verifyEmailOtp(const QString &email, const QString &code);
    void signOut();
    bool isAuthenticated() const;
    QString authToken() const;
    void setAuthToken(const QString &token);

    // HTTP actions
    using ActionCallback = std::function<void(bool success, const QJsonObject &result, const QString &error)>;
    void callAction(const QString &actionName, const QJsonObject &args, ActionCallback callback);

    // Streaming SSE chat
    using StreamChunkCallback = std::function<void(const QString &text)>;
    using StreamDoneCallback = std::function<void()>;
    void startChatStream(const QString &message, const QString &mode,
                         StreamChunkCallback onChunk, StreamDoneCallback onDone);
    void cancelStream();

    // WebSocket (VM bridge)
    void connectWebSocket(const QUrl &url);
    void sendWebSocketMessage(const QByteArray &message);
    QWebSocket *webSocket() const;

signals:
    void authStateChanged(bool authenticated);
    void otpSent(bool success, const QString &error);
    void otpVerified(bool success, const QString &error);
    void connectionError(const QString &error);

private slots:
    void onStreamDataReady();
    void onStreamFinished();

private:
    QNetworkRequest createRequest(const QString &path) const;
    void handleActionResponse(QNetworkReply *reply, ActionCallback callback);

    QNetworkAccessManager *m_networkManager;
    QWebSocket *m_webSocket;
    QString m_baseUrl;
    QString m_authToken;
    bool m_authenticated;

    // Streaming state
    QNetworkReply *m_streamReply;
    QByteArray m_streamBuffer;
    StreamChunkCallback m_streamChunkCallback;
    StreamDoneCallback m_streamDoneCallback;
};
