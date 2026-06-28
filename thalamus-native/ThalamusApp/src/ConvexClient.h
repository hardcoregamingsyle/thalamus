#ifndef CONVEXCLIENT_H
#define CONVEXCLIENT_H

#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QJsonObject>
#include <QJsonArray>
#include <QWebSocket>
#include <functional>
#include <QDateTime>

/**
 * @brief HTTP/WebSocket client for Convex backend communication.
 *
 * Handles:
 * - Auth (email OTP)
 * - Chat streaming (SSE endpoint)
 * - Convex queries, mutations, and actions via the REST API
 * - User session management
 */
class ConvexClient : public QObject
{
    Q_OBJECT

public:
    explicit ConvexClient(QObject *parent = nullptr);
    ~ConvexClient();

    // ── Configuration ──────────────────────────────────────────────────────
    void setConvexUrl(const QString &url);
    void setSiteUrl(const QString &url);
    QString convexUrl() const { return m_convexUrl; }
    QString siteUrl() const { return m_siteUrl; }

    // ── Auth ────────────────────────────────────────────────────────────────
    /// Send OTP to email
    void sendAuthCode(const QString &email);
    /// Verify OTP code and get session token
    void verifyAuthCode(const QString &email, const QString &code);
    /// Check if user is authenticated
    bool isAuthenticated() const { return !m_authToken.isEmpty(); }
    /// Get auth token
    QString authToken() const { return m_authToken; }
    /// Get current user info
    QJsonObject currentUser() const { return m_currentUser; }
    /// Load session from stored token
    void loadSession(const QString &token);
    /// Clear session
    void logout();

    // ── User ────────────────────────────────────────────────────────────────
    /// Get current user from server
    void fetchCurrentUser();

    // ── Conversations ───────────────────────────────────────────────────────
    /// List user conversations by mode
    void listConversations(const QString &mode);
    /// Create or get a conversation
    void createConversation(const QString &title, const QString &mode);
    /// Get conversation messages
    void getConversationMessages(const QString &conversationId);

    // ── Chat / Streaming ────────────────────────────────────────────────────
    /// Send chat message via SSE streaming endpoint.
    ///  - content: user message
    ///  - mode: chat | research | study | code
    ///  - history: previous messages
    ///  - systemPrompt: system instructions
    ///  - conversationId: optional conversation to save to
    ///  - token: auth token for saving
    ///  - onChunk: streaming callback for each text chunk
    ///  - onDone: final callback with full response
    void streamChat(
        const QString &content,
        const QString &mode,
        const QJsonArray &history,
        const QString &systemPrompt,
        const QString &conversationId,
        const QString &token,
        std::function<void(const QString&)> onChunk,
        std::function<void(const QString&, bool)> onDone
    );

    // ── Convex Direct API (bypasses streaming) ─────────────────────────────
    /// Execute a Convex query
    void query(const QString &functionPath, const QJsonObject &args);
    /// Execute a Convex mutation
    void mutation(const QString &functionPath, const QJsonObject &args);
    /// Execute a Convex action
    void action(const QString &functionPath, const QJsonObject &args);

    // ── Convex File Upload ──────────────────────────────────────────────────
    void generateUploadUrl();
    void uploadFile(const QString &url, const QByteArray &data, const QString &contentType);

    // ── VM Bridge ───────────────────────────────────────────────────────────
    /// Connect to local VM bridge via WebSocket
    void connectVMBridge();
    /// Disconnect from VM bridge
    void disconnectVMBridge();
    /// Send command to VM bridge
    void sendVMCommand(const QJsonObject &cmd);
    /// Check if VM bridge is connected
    bool isVMBridgeConnected() const { return m_vmBridge && m_vmBridge->state() == QAbstractSocket::ConnectedState; }

signals:
    // Auth signals
    void authCodeSent(bool success, const QString &error = QString());
    void authVerified(bool success, const QString &error = QString());
    void sessionLoaded(bool valid);
    void userFetched(const QJsonObject &user);
    void loggedOut();

    // Data signals
    void conversationsLoaded(const QJsonArray &conversations);
    void conversationCreated(const QJsonObject &conversation);
    void messagesLoaded(const QJsonArray &messages);

    // API signals
    void queryResult(const QJsonValue &result);
    void mutationResult(const QJsonValue &result);
    void actionResult(const QJsonValue &result);
    void uploadUrlReady(const QString &url);
    void uploadComplete(bool success);

    // Error signal
    void errorOccurred(const QString &error);

    // VM Bridge signals
    void vmBridgeConnected();
    void vmBridgeDisconnected();
    void vmBridgeMessage(const QJsonObject &msg);

private slots:
    void onVMBridgeConnected();
    void onVMBridgeDisconnected();
    void onVMBridgeTextMessage(const QString &message);

private:
    QNetworkReply* makeRequest(const QString &endpoint, const QJsonObject &body);
    QNetworkReply* makeGetRequest(const QString &endpoint);
    void handleReplyError(QNetworkReply *reply);

    QNetworkAccessManager *m_network;
    QString m_convexUrl;
    QString m_siteUrl;
    QString m_authToken;
    QJsonObject m_currentUser;

    // VM Bridge WebSocket
    QWebSocket *m_vmBridge;
    QString m_vmBridgeUrl;
};

#endif // CONVEXCLIENT_H
