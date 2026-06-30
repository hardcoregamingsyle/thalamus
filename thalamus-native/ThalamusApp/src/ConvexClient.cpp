// Thalamus AI — ConvexClient.cpp
#include "ConvexClient.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QNetworkReply>
#include <QUrlQuery>
#include <QWebSocket>
#include <QRegularExpression>

ConvexClient::ConvexClient(QObject *parent)
    : QObject(parent)
    , m_networkManager(new QNetworkAccessManager(this))
    , m_webSocket(new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this))
    , m_baseUrl("https://glad-ermine-937.convex.cloud")
    , m_authenticated(false)
    , m_streamReply(nullptr)
{
    // WebSocket cleanup on disconnect
    connect(m_webSocket, &QWebSocket::disconnected, this, [this]() {
        m_webSocket->deleteLater();
        m_webSocket = new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this);
    });
}

ConvexClient::~ConvexClient()
{
    cancelStream();
}

void ConvexClient::setBaseUrl(const QString &url)
{
    m_baseUrl = url;
    // Strip trailing slash
    while (m_baseUrl.endsWith('/'))
        m_baseUrl.chop(1);
}

QString ConvexClient::baseUrl() const { return m_baseUrl; }

// ── Auth ─────────────────────────────────────────────────────────────────────

void ConvexClient::sendEmailOtp(const QString &email)
{
    QJsonObject args;
    args["email"] = email;

    callAction("auth:sendEmailOtp", args, [this](bool success, const QJsonObject &, const QString &error) {
        if (success) {
            emit otpSent(true, QString());
        } else {
            emit otpSent(false, error);
        }
    });
}

void ConvexClient::verifyEmailOtp(const QString &email, const QString &code)
{
    QJsonObject args;
    args["email"] = email;
    args["code"] = code;

    callAction("auth:verifyEmailOtp", args, [this](bool success, const QJsonObject &result, const QString &error) {
        if (success) {
            m_authToken = result["token"].toString();
            m_authenticated = true;
            emit authStateChanged(true);
            emit otpVerified(true, QString());
        } else {
            m_authenticated = false;
            emit authStateChanged(false);
            emit otpVerified(false, error);
        }
    });
}

void ConvexClient::signOut()
{
    m_authToken.clear();
    m_authenticated = false;
    emit authStateChanged(false);
}

bool ConvexClient::isAuthenticated() const { return m_authenticated; }
QString ConvexClient::authToken() const { return m_authToken; }

// ── HTTP calls ───────────────────────────────────────────────────────────────

void ConvexClient::callAction(const QString &actionName, const QJsonObject &args, ActionCallback callback)
{
    QUrl url(m_baseUrl + "/api/action/" + actionName);
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("Convex-Client", "thalamus-native/1.0.0");

    if (m_authenticated) {
        request.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    }

    QJsonObject body;
    body["args"] = args;
    QByteArray data = QJsonDocument(body).toJson(QJsonDocument::Compact);

    QNetworkReply *reply = m_networkManager->post(request, data);
    connect(reply, &QNetworkReply::finished, this, [this, reply, callback]() {
        handleActionResponse(reply, callback);
    });
}

void ConvexClient::handleActionResponse(QNetworkReply *reply, ActionCallback callback)
{
    reply->deleteLater();

    if (reply->error() != QNetworkReply::NoError) {
        callback(false, QJsonObject(), reply->errorString());
        return;
    }

    QByteArray responseData = reply->readAll();
    QJsonDocument doc = QJsonDocument::fromJson(responseData);
    QJsonObject response = doc.object();

    if (response.contains("error")) {
        QString errorMsg = response["error"].toObject()["message"].toString();
        if (errorMsg.isEmpty()) errorMsg = response["error"].toString();
        callback(false, QJsonObject(), errorMsg);
    } else {
        QJsonObject result = response["result"].toObject();
        callback(true, result, QString());
    }
}

// ── Streaming SSE Chat ───────────────────────────────────────────────────────

void ConvexClient::startChatStream(const QString &message, const QString &mode,
                                   StreamChunkCallback onChunk, StreamDoneCallback onDone)
{
    cancelStream();

    m_streamChunkCallback = onChunk;
    m_streamDoneCallback = onDone;
    m_streamBuffer.clear();

    QUrl url(m_baseUrl + "/api/sse/chat");
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("Accept", "text/event-stream");
    request.setRawHeader("Cache-Control", "no-cache");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::NoLessSafeRedirectPolicy);

    if (m_authenticated) {
        request.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    }

    QJsonObject body;
    body["message"] = message;
    body["mode"] = mode;
    QByteArray data = QJsonDocument(body).toJson(QJsonDocument::Compact);

    m_streamReply = m_networkManager->post(request, data);

    connect(m_streamReply, &QNetworkReply::readyRead, this, &ConvexClient::onStreamDataReady);
    connect(m_streamReply, &QNetworkReply::finished, this, &ConvexClient::onStreamFinished);
}

void ConvexClient::cancelStream()
{
    if (m_streamReply) {
        m_streamReply->abort();
        m_streamReply->deleteLater();
        m_streamReply = nullptr;
    }
    m_streamChunkCallback = nullptr;
    m_streamDoneCallback = nullptr;
    m_streamBuffer.clear();
}

void ConvexClient::onStreamDataReady()
{
    if (!m_streamReply) return;

    m_streamBuffer.append(m_streamReply->readAll());

    // Parse SSE lines from buffer
    while (true) {
        int newlinePos = m_streamBuffer.indexOf('\n');
        if (newlinePos < 0) break;

        QByteArray line = m_streamBuffer.left(newlinePos).trimmed();
        m_streamBuffer.remove(0, newlinePos + 1);

        if (line.isEmpty()) continue;

        // SSE: "data: ..." or "event: ..."
        if (line.startsWith("data: ")) {
            QByteArray payload = line.mid(6);
            if (payload == "[DONE]") {
                // Stream complete
            } else {
                m_streamChunkCallback(QString::fromUtf8(payload));
            }
        }
    }
}

void ConvexClient::onStreamFinished()
{
    if (m_streamReply) {
        m_streamReply->deleteLater();
        m_streamReply = nullptr;
    }
    if (m_streamDoneCallback) {
        m_streamDoneCallback();
    }
}

// ── WebSocket (VM Bridge) ────────────────────────────────────────────────────

void ConvexClient::connectWebSocket(const QUrl &url)
{
    m_webSocket->open(url);
}

void ConvexClient::sendWebSocketMessage(const QByteArray &message)
{
    if (m_webSocket->state() == QAbstractSocket::ConnectedState) {
        m_webSocket->sendTextMessage(QString::fromUtf8(message));
    }
}

QWebSocket *ConvexClient::webSocket() const { return m_webSocket; }
