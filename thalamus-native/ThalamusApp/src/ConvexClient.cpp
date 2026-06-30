/**
 * Thalamus AI — Convex Backend Client
 * HTTP/SSE communication with the Convex deployment.
 * Handles chat streaming, auth, and guest mode.
 */

#include "ConvexClient.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QNetworkRequest>
#include <QUrl>
#include <QSettings>

static const QString DEFAULT_BACKEND_URL = "https://glad-ermine-937.convex.cloud";
static const QString STREAM_CHAT_PATH = "/stream-chat";

ConvexClient::ConvexClient(QObject *parent)
    : QObject(parent)
    , m_nam(new QNetworkAccessManager(this))
    , m_streamReply(nullptr)
    , m_streaming(false)
{
    QSettings settings;
    m_backendUrl = settings.value("backendUrl", DEFAULT_BACKEND_URL).toString();
    m_authToken = settings.value("authToken").toString();
}

void ConvexClient::setBackendUrl(const QString &url) {
    m_backendUrl = url;
    QSettings settings;
    settings.setValue("backendUrl", url);
}

QString ConvexClient::backendUrl() const { return m_backendUrl; }

void ConvexClient::setAuthToken(const QString &token) {
    m_authToken = token;
    QSettings settings;
    settings.setValue("authToken", token);
    emit authStateChanged(!token.isEmpty());
}

QString ConvexClient::authToken() const { return m_authToken; }

bool ConvexClient::isAuthenticated() const { return !m_authToken.isEmpty(); }
bool ConvexClient::isStreaming() const { return m_streaming; }

QNetworkRequest ConvexClient::buildRequest(const QString &path, bool json) const {
    QUrl url(m_backendUrl + path);
    QNetworkRequest req(url);
    if (json) {
        req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    }
    req.setRawHeader("Accept", "text/event-stream");
    return req;
}

void ConvexClient::streamChat(const QString &content,
                               const QString &mode,
                               const QJsonArray &history,
                               const QString &systemPrompt,
                               const QString &conversationId)
{
    if (m_streaming) return;

    QJsonObject body;
    body["content"] = content;
    body["mode"] = mode;
    body["history"] = history;
    body["systemPrompt"] = systemPrompt;

    if (!m_authToken.isEmpty()) {
        body["token"] = m_authToken;
    }
    if (!conversationId.isEmpty()) {
        body["conversationId"] = conversationId;
    }

    // User context
    QDateTime now = QDateTime::currentDateTime();
    QJsonObject ctx;
    ctx["datetime"] = now.toString(Qt::ISODate);
    ctx["timezone"] = now.timeZone().id();
    body["userContext"] = ctx;

    QNetworkRequest req = buildRequest(STREAM_CHAT_PATH);
    QByteArray data = QJsonDocument(body).toJson(QJsonDocument::Compact);

    m_streaming = true;
    m_streamBuffer.clear();
    m_streamReply = m_nam->post(req, data);

    connect(m_streamReply, &QNetworkReply::readyRead,
            this, &ConvexClient::onStreamReadyRead);
    connect(m_streamReply, &QNetworkReply::finished,
            this, &ConvexClient::onStreamFinished);
}

void ConvexClient::guestChat(const QString &content,
                              const QString &mode,
                              const QJsonArray &history)
{
    QJsonObject body;
    body["content"] = content;
    body["mode"] = mode;
    body["history"] = history;

    QDateTime now = QDateTime::currentDateTime();
    QJsonObject ctx;
    ctx["datetime"] = now.toString(Qt::ISODate);
    ctx["timezone"] = now.timeZone().id();
    body["userContext"] = ctx;

    QNetworkRequest req = buildRequest(STREAM_CHAT_PATH);
    QByteArray data = QJsonDocument(body).toJson(QJsonDocument::Compact);

    m_streaming = true;
    m_streamBuffer.clear();
    m_streamReply = m_nam->post(req, data);

    connect(m_streamReply, &QNetworkReply::readyRead,
            this, &ConvexClient::onStreamReadyRead);
    connect(m_streamReply, &QNetworkReply::finished,
            this, &ConvexClient::onStreamFinished);
}

void ConvexClient::generateTitle(const QString &firstMessage, const QString &conversationId) {
    // Title generation is done server-side via the stream-chat endpoint
    Q_UNUSED(firstMessage);
    Q_UNUSED(conversationId);
}

void ConvexClient::onStreamReadyRead() {
    if (!m_streamReply) return;

    m_streamBuffer += m_streamReply->readAll();

    // Process complete SSE lines
    while (m_streamBuffer.contains('\n')) {
        int idx = m_streamBuffer.indexOf('\n');
        QString line = QString::fromUtf8(m_streamBuffer.left(idx)).trimmed();
        m_streamBuffer = m_streamBuffer.mid(idx + 1);

        if (!line.isEmpty()) {
            parseSSELine(line);
        }
    }
}

void ConvexClient::parseSSELine(const QString &line) {
    if (!line.startsWith("data: ")) return;

    QByteArray jsonBytes = line.mid(6).toUtf8();
    QJsonParseError err;
    QJsonDocument doc = QJsonDocument::fromJson(jsonBytes, &err);
    if (err.error != QJsonParseError::NoError) return;

    QJsonObject obj = doc.object();
    QString type = obj["type"].toString();

    if (type == "thinking") {
        emit streamThinking(obj["chunk"].toString());
    } else if (type == "answer_start") {
        emit streamAnswerStart();
    } else if (type == "answer") {
        emit streamChunk(obj["chunk"].toString());
    } else if (type == "done") {
        emit streamDone(obj["fullText"].toString());
    }
}

void ConvexClient::onStreamFinished() {
    if (!m_streamReply) return;

    if (m_streamReply->error() != QNetworkReply::NoError) {
        emit streamError(m_streamReply->errorString());
    }

    m_streamReply->deleteLater();
    m_streamReply = nullptr;
    m_streaming = false;
}

void ConvexClient::onReplyFinished(QNetworkReply *reply) {
    reply->deleteLater();
}

void ConvexClient::guestChat(const QString &content, const QString &mode, const QJsonArray &history);
