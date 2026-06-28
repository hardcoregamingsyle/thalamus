#include "ConvexClient.h"
#include <QJsonDocument>
#include <QJsonValue>
#include <QUrlQuery>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QRandomGenerator>
#include <QCryptographicHash>
#include <QProcessEnvironment>

ConvexClient::ConvexClient(QObject *parent)
    : QObject(parent)
    , m_network(new QNetworkAccessManager(this))
    , m_vmBridge(nullptr)
    , m_vmBridgeUrl("ws://localhost:5900")
{
}

ConvexClient::~ConvexClient()
{
    disconnectVMBridge();
}

void ConvexClient::setConvexUrl(const QString &url)
{
    m_convexUrl = url;
}

void ConvexClient::setSiteUrl(const QString &url)
{
    m_siteUrl = url;
}

// ── Auth ────────────────────────────────────────────────────────────────────

void ConvexClient::sendAuthCode(const QString &email)
{
    // Convex auth: send OTP via email
    // POST /api/auth/sendCode  { email, applicationID: "convex" }
    QUrl url(m_convexUrl + "/api/auth/sendCode");
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");

    QJsonObject body;
    body["email"] = email;
    body["applicationID"] = "convex";

    QNetworkReply *reply = m_network->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit authCodeSent(false, reply->errorString());
            return;
        }
        emit authCodeSent(true);
    });
}

void ConvexClient::verifyAuthCode(const QString &email, const QString &code)
{
    QUrl url(m_convexUrl + "/api/auth/verifyCode");
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");

    QJsonObject body;
    body["email"] = email;
    body["code"] = code;
    body["applicationID"] = "convex";

    QNetworkReply *reply = m_network->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit authVerified(false, reply->errorString());
            return;
        }
        QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
        QJsonObject obj = doc.object();

        // Auth token stored in response
        if (obj.contains("token")) {
            m_authToken = obj["token"].toString();
            emit authVerified(true);
        } else if (obj.contains("value") && obj["value"].isObject()) {
            m_authToken = obj["value"].toObject()["token"].toString();
            emit authVerified(true);
        } else {
            emit authVerified(false, "Invalid auth response");
        }
    });
}

void ConvexClient::loadSession(const QString &token)
{
    m_authToken = token;
    if (token.isEmpty()) {
        emit sessionLoaded(false);
        return;
    }
    fetchCurrentUser();
}

void ConvexClient::logout()
{
    m_authToken.clear();
    m_currentUser = QJsonObject();
    emit loggedOut();
}

void ConvexClient::fetchCurrentUser()
{
    // Use Convex query: users:getCurrentUser or similar
    QJsonObject args;
    query("users:getCurrentUser", args);
}

// ── Conversations ────────────────────────────────────────────────────────────

void ConvexClient::listConversations(const QString &mode)
{
    QJsonObject args;
    args["mode"] = mode;
    query("conversations:list", args);
}

void ConvexClient::createConversation(const QString &title, const QString &mode)
{
    QJsonObject args;
    args["title"] = title;
    args["mode"] = mode;
    mutation("conversations:create", args);
}

void ConvexClient::getConversationMessages(const QString &conversationId)
{
    QJsonObject args;
    args["conversationId"] = conversationId;
    query("conversations:getMessages", args);
}

// ── Chat Streaming ──────────────────────────────────────────────────────────

void ConvexClient::streamChat(
    const QString &content,
    const QString &mode,
    const QJsonArray &history,
    const QString &systemPrompt,
    const QString &conversationId,
    const QString &token,
    std::function<void(const QString&)> onChunk,
    std::function<void(const QString&, bool)> onDone)
{
    // Use the HTTP SSE streaming endpoint
    QUrl url(m_convexUrl + "/stream-chat");
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setRawHeader("Accept", "text/event-stream");
    req.setRawHeader("Cache-Control", "no-cache");

    QJsonObject body;
    body["content"] = content;
    body["mode"] = mode;
    body["history"] = history;
    body["systemPrompt"] = systemPrompt;

    if (!token.isEmpty()) {
        body["token"] = token;
    }
    if (!conversationId.isEmpty()) {
        body["conversationId"] = conversationId;
    }

    // Add user context
    QJsonObject userContext;
    userContext["datetime"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
    userContext["timezone"] = QDateTime::currentDateTime().timeZoneAbbreviation();
    body["userContext"] = userContext;

    QSharedPointer<QByteArray> buffer(new QByteArray());
    QNetworkReply *reply = m_network->post(req, QJsonDocument(body).toJson());

    // Connect to readyRead for streaming
    connect(reply, &QNetworkReply::readyRead, this, [reply, onChunk, buffer]() {
        buffer->append(reply->readAll());

        // Parse SSE events
        while (true) {
            int lineEnd = buffer->indexOf('\n');
            if (lineEnd < 0) break;

            QByteArray line = buffer->left(lineEnd).trimmed();
            *buffer = buffer->mid(lineEnd + 1);

            if (line.isEmpty()) continue; // blank line = event separator

            if (line.startsWith("data: ")) {
                QByteArray data = line.mid(6); // strip "data: " prefix
                QJsonDocument doc = QJsonDocument::fromJson(data);
                if (doc.isObject()) {
                    QJsonObject evt = doc.object();
                    QString type = evt["type"].toString();

                    if (type == "answer") {
                        QString chunk = evt["chunk"].toString();
                        if (onChunk) onChunk(chunk);
                    } else if (type == "done") {
                        // Done signal — will be handled in finished signal
                    } else if (type == "thinking") {
                        // Thinking indicator — could show in UI
                        if (onChunk) onChunk(""); // heartbeat
                    }
                }
            }
        }
    });

    connect(reply, &QNetworkReply::finished, this, [this, reply, onDone]() {
        reply->deleteLater();
        QByteArray remaining = reply->readAll();

        // Try to extract full response from remaining buffer
        QString fullText;
        bool success = reply->error() == QNetworkReply::NoError;

        // Parse remaining SSE data
        for (const QByteArray &line : remaining.split('\n')) {
            if (line.trimmed().startsWith("data: ")) {
                QJsonDocument doc = QJsonDocument::fromJson(line.mid(6));
                if (doc.isObject()) {
                    QJsonObject evt = doc.object();
                    if (evt["type"].toString() == "done") {
                        fullText = evt["fullText"].toString();
                    }
                }
            }
        }

        if (fullText.isEmpty() && success) {
            fullText = QString::fromUtf8(remaining);
        }

        if (onDone) onDone(fullText, success);
    });
}

// ── Convex REST API ─────────────────────────────────────────────────────────

void ConvexClient::query(const QString &functionPath, const QJsonObject &args)
{
    QUrl url(m_convexUrl + "/api/query");
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    if (!m_authToken.isEmpty()) {
        req.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    }

    QJsonObject body;
    body["path"] = functionPath;
    body["args"] = args;

    QNetworkReply *reply = m_network->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit errorOccurred("Query failed: " + reply->errorString());
            return;
        }
        QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
        emit queryResult(doc.object()["value"]);
    });
}

void ConvexClient::mutation(const QString &functionPath, const QJsonObject &args)
{
    QUrl url(m_convexUrl + "/api/mutation");
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    if (!m_authToken.isEmpty()) {
        req.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    }

    QJsonObject body;
    body["path"] = functionPath;
    body["args"] = args;

    QNetworkReply *reply = m_network->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit errorOccurred("Mutation failed: " + reply->errorString());
            return;
        }
        QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
        emit mutationResult(doc.object()["value"]);
    });
}

void ConvexClient::action(const QString &functionPath, const QJsonObject &args)
{
    QUrl url(m_convexUrl + "/api/action");
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    if (!m_authToken.isEmpty()) {
        req.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    }

    QJsonObject body;
    body["path"] = functionPath;
    body["args"] = args;

    QNetworkReply *reply = m_network->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit errorOccurred("Action failed: " + reply->errorString());
            return;
        }
        QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
        emit actionResult(doc.object()["value"]);
    });
}

void ConvexClient::generateUploadUrl()
{
    mutation("storage:generateUploadUrl", QJsonObject());
}

void ConvexClient::uploadFile(const QString &url, const QByteArray &data, const QString &contentType)
{
    QNetworkRequest req(QUrl(url));
    req.setRawHeader("Content-Type", contentType.toUtf8());

    QNetworkReply *reply = m_network->put(req, data);
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        emit uploadComplete(reply->error() == QNetworkReply::NoError);
    });
}

// ── VM Bridge WebSocket ─────────────────────────────────────────────────────

void ConvexClient::connectVMBridge()
{
    if (m_vmBridge) {
        if (m_vmBridge->state() == QAbstractSocket::ConnectedState) return;
        disconnectVMBridge();
    }

    m_vmBridge = new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this);

    connect(m_vmBridge, &QWebSocket::connected, this, &ConvexClient::onVMBridgeConnected);
    connect(m_vmBridge, &QWebSocket::disconnected, this, &ConvexClient::onVMBridgeDisconnected);
    connect(m_vmBridge, &QWebSocket::textMessageReceived, this, &ConvexClient::onVMBridgeTextMessage);

    m_vmBridge->open(QUrl(m_vmBridgeUrl));
}

void ConvexClient::disconnectVMBridge()
{
    if (m_vmBridge) {
        m_vmBridge->close();
        m_vmBridge->deleteLater();
        m_vmBridge = nullptr;
    }
}

void ConvexClient::sendVMCommand(const QJsonObject &cmd)
{
    if (!m_vmBridge || m_vmBridge->state() != QAbstractSocket::ConnectedState)
        return;
    m_vmBridge->sendTextMessage(QJsonDocument(cmd).toJson(QJsonDocument::Compact));
}

void ConvexClient::onVMBridgeConnected()
{
    emit vmBridgeConnected();
}

void ConvexClient::onVMBridgeDisconnected()
{
    emit vmBridgeDisconnected();
}

void ConvexClient::onVMBridgeTextMessage(const QString &message)
{
    QJsonDocument doc = QJsonDocument::fromJson(message.toUtf8());
    if (doc.isObject()) {
        emit vmBridgeMessage(doc.object());
    }
}

// ── Private Helpers ─────────────────────────────────────────────────────────

QNetworkReply* ConvexClient::makeRequest(const QString &endpoint, const QJsonObject &body)
{
    QUrl url(m_convexUrl + endpoint);
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    if (!m_authToken.isEmpty()) {
        req.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    }
    return m_network->post(req, QJsonDocument(body).toJson());
}

QNetworkReply* ConvexClient::makeGetRequest(const QString &endpoint)
{
    QUrl url(m_convexUrl + endpoint);
    QNetworkRequest req(url);
    if (!m_authToken.isEmpty()) {
        req.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());
    }
    return m_network->get(req);
}

void ConvexClient::handleReplyError(QNetworkReply *reply)
{
    QString errorMsg = reply->errorString();
    QByteArray body = reply->readAll();
    if (!body.isEmpty()) {
        QJsonDocument doc = QJsonDocument::fromJson(body);
        if (doc.isObject() && doc.object().contains("message")) {
            errorMsg = doc.object()["message"].toString();
        }
    }
    emit errorOccurred(errorMsg);
}
