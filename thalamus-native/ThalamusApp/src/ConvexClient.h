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
    void setAuthToken(const QString &token);
    void sendEmailOtp(const QString &email);
    void verifyEmailOtp(const QString &email, const QString &code);
    void signOut();
    bool isAuthenticated() const;
    QString authToken() const;

    using ActionCallback = std::function<void(bool, const QJsonObject &, const QString &)>;
    void callAction(const QString &actionName, const QJsonObject &args, ActionCallback cb);

    using StreamChunkCallback = std::function<void(const QString &)>;
    using StreamDoneCallback = std::function<void()>;
    void startChatStream(const QString &msg, const QString &mode,
                         StreamChunkCallback onChunk, StreamDoneCallback onDone);
    void cancelStream();
    void connectWebSocket(const QUrl &url);
    void sendWebSocketMessage(const QByteArray &msg);
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
    void handleActionResponse(QNetworkReply *reply, ActionCallback cb);

    QNetworkAccessManager *m_networkManager;
    QWebSocket *m_webSocket;
    QString m_baseUrl;
    QString m_authToken;
    bool m_authenticated;
    QNetworkReply *m_streamReply;
    QByteArray m_streamBuffer;
    StreamChunkCallback m_streamChunkCallback;
    StreamDoneCallback m_streamDoneCallback;
};
