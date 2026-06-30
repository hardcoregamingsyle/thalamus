// Thalamus AI — ConvexClient.cpp
#include "ConvexClient.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QUrlQuery>

ConvexClient::ConvexClient(QObject *parent)
    : QObject(parent)
    , m_networkManager(new QNetworkAccessManager(this))
    , m_webSocket(new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this))
    , m_baseUrl("https://glad-ermine-937.convex.cloud")
    , m_authenticated(false)
    , m_streamReply(nullptr)
{
    connect(m_webSocket, &QWebSocket::disconnected, this, [this]() {
        m_webSocket->deleteLater();
        m_webSocket = new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this);
    });
}

ConvexClient::~ConvexClient() { cancelStream(); }

void ConvexClient::setBaseUrl(const QString &url)
{
    m_baseUrl = url;
    while (m_baseUrl.endsWith('/')) m_baseUrl.chop(1);
}

QString ConvexClient::baseUrl() const { return m_baseUrl; }
void ConvexClient::setAuthToken(const QString &token) {
    m_authToken = token; m_authenticated = !token.isEmpty();
    emit authStateChanged(m_authenticated);
}
void ConvexClient::sendEmailOtp(const QString &email) {
    QJsonObject a; a["email"] = email;
    callAction("auth:sendEmailOtp", a, [this](bool ok, const QJsonObject &, const QString &err) {
        emit otpSent(ok, err);
    });
}
void ConvexClient::verifyEmailOtp(const QString &email, const QString &code) {
    QJsonObject a; a["email"] = email; a["code"] = code;
    callAction("auth:verifyEmailOtp", a, [this](bool ok, const QJsonObject &r, const QString &err) {
        if (ok) {
            m_authToken = r["token"].toString();
            m_authenticated = true;
            emit authStateChanged(true);
            emit otpVerified(true, QString());
        } else {
            m_authenticated = false;
            emit authStateChanged(false);
            emit otpVerified(false, err);
        }
    });
}
void ConvexClient::signOut() {
    m_authToken.clear(); m_authenticated = false; emit authStateChanged(false);
}
bool ConvexClient::isAuthenticated() const { return m_authenticated; }
QString ConvexClient::authToken() const { return m_authToken; }

QNetworkRequest ConvexClient::createRequest(const QString &path) const
{
    QNetworkRequest r(QUrl(m_baseUrl + path));
    r.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    r.setRawHeader("Convex-Client", "thalamus-native/1.0.0");
    if (m_authenticated)
        r.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    return r;
}

void ConvexClient::callAction(const QString &name, const QJsonObject &args, ActionCallback cb)
{
    QJsonObject body; body["args"] = args;
    QNetworkReply *reply = m_networkManager->post(
        createRequest("/api/action/" + name),
        QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, cb]() {
        handleActionResponse(reply, cb);
    });
}

void ConvexClient::handleActionResponse(QNetworkReply *reply, ActionCallback cb)
{
    reply->deleteLater();
    if (reply->error() != QNetworkReply::NoError)
        { cb(false, QJsonObject(), reply->errorString()); return; }
    QJsonObject resp = QJsonDocument::fromJson(reply->readAll()).object();
    if (resp.contains("error"))
        cb(false, QJsonObject(), resp["error"].toObject()["message"].toString());
    else
        cb(true, resp["result"].toObject(), QString());
}

void ConvexClient::startChatStream(const QString &msg, const QString &mode,
                                   StreamChunkCallback onChunk, StreamDoneCallback onDone)
{
    cancelStream();
    m_streamChunkCallback = onChunk;
    m_streamDoneCallback = onDone;
    m_streamBuffer.clear();

    QNetworkRequest req = createRequest("/api/sse/chat");
    req.setRawHeader("Accept", "text/event-stream");
    req.setRawHeader("Cache-Control", "no-cache");

    QJsonObject body; body["message"] = msg; body["mode"] = mode;
    m_streamReply = m_networkManager->post(
        req, QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(m_streamReply, &QNetworkReply::readyRead, this, &ConvexClient::onStreamDataReady);
    connect(m_streamReply, &QNetworkReply::finished, this, &ConvexClient::onStreamFinished);
}

void ConvexClient::cancelStream()
{
    if (m_streamReply) { m_streamReply->abort(); m_streamReply->deleteLater(); m_streamReply = nullptr; }
    m_streamChunkCallback = nullptr; m_streamDoneCallback = nullptr; m_streamBuffer.clear();
}

void ConvexClient::onStreamDataReady()
{
    if (!m_streamReply) return;
    m_streamBuffer.append(m_streamReply->readAll());
    while (true) {
        int nl = m_streamBuffer.indexOf('\n');
        if (nl < 0) break;
        QByteArray line = m_streamBuffer.left(nl).trimmed();
        m_streamBuffer.remove(0, nl + 1);
        if (line.isEmpty()) continue;
        if (line.startsWith("data: ")) {
            QByteArray payload = line.mid(6);
            if (payload != "[DONE]" && m_streamChunkCallback)
                m_streamChunkCallback(QString::fromUtf8(payload));
        }
    }
}

void ConvexClient::onStreamFinished()
{
    if (m_streamReply) { m_streamReply->deleteLater(); m_streamReply = nullptr; }
    if (m_streamDoneCallback) m_streamDoneCallback();
}

void ConvexClient::connectWebSocket(const QUrl &url) { m_webSocket->open(url); }
void ConvexClient::sendWebSocketMessage(const QByteArray &msg) {
    if (m_webSocket->state() == QAbstractSocket::ConnectedState)
        m_webSocket->sendTextMessage(QString::fromUtf8(msg));
}
QWebSocket *ConvexClient::webSocket() const { return m_webSocket; }
