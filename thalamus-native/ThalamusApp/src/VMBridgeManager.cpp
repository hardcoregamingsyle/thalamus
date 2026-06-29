#include "VMBridgeManager.h"
#include <QJsonDocument>
#include <QFile>
#include <QDir>
#include <QCoreApplication>

VMBridgeManager::VMBridgeManager(QObject *parent)
    : QObject(parent)
    , m_ws(nullptr)
    , m_bridgeProcess(nullptr)
    , m_vncPort(5901)
    , m_connectRetries(0)
{
}

VMBridgeManager::~VMBridgeManager()
{
    disconnectFromBridge();
    if (m_bridgeProcess) {
        m_bridgeProcess->terminate();
        if (!m_bridgeProcess->waitForFinished(5000)) {
            m_bridgeProcess->kill();
            m_bridgeProcess->waitForFinished(3000);
        }
    }
}

bool VMBridgeManager::isConnected() const
{
    return m_ws && m_ws->state() == QAbstractSocket::ConnectedState;
}

void VMBridgeManager::connectToBridge(const QString &url)
{
    m_bridgeUrl = url;

    if (m_ws) {
        if (m_ws->state() == QAbstractSocket::ConnectedState) return;
        disconnectFromBridge();
    }

    m_ws = new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this);

    connect(m_ws, &QWebSocket::connected, this, &VMBridgeManager::onWsConnected);
    connect(m_ws, &QWebSocket::disconnected, this, &VMBridgeManager::onWsDisconnected);
    connect(m_ws, &QWebSocket::textMessageReceived, this, &VMBridgeManager::onWsTextMessage);
    connect(m_ws, &QWebSocket::errorOccurred,
            this, &VMBridgeManager::onWsError);

    m_ws->open(QUrl(m_bridgeUrl));
}

void VMBridgeManager::disconnectFromBridge()
{
    if (m_ws) {
        m_ws->close();
        m_ws->deleteLater();
        m_ws = nullptr;
    }
}

void VMBridgeManager::bootVM(const QString &os, int ramMB, int cores)
{
    if (!isConnected()) return;

    QJsonObject cmd;
    cmd["action"] = "boot";
    cmd["os"] = os;
    cmd["ram"] = ramMB;
    cmd["cores"] = cores;
    sendCommand(cmd);
}

void VMBridgeManager::stopVM(const QString &vmId)
{
    if (!isConnected()) return;

    QJsonObject cmd;
    cmd["action"] = "stop";
    cmd["vmId"] = vmId;
    sendCommand(cmd);
}

void VMBridgeManager::listVMs()
{
    if (!isConnected()) return;
    sendCommand(QJsonObject{{"action", "list"}});
}

void VMBridgeManager::ping()
{
    if (!isConnected()) return;
    sendCommand(QJsonObject{{"action", "ping"}});
}

void VMBridgeManager::launchBridgeProcess(const QString &bridgePath)
{
    if (m_bridgeProcess && m_bridgeProcess->state() != QProcess::NotRunning) {
        // Already running
        return;
    }

    QString path = bridgePath;
    if (path.isEmpty()) {
        // Look for bridge in app directory
        QString appDir = QCoreApplication::applicationDirPath();
        QStringList candidates = {
            appDir + "/thalamus-vm-bridge.exe",
            appDir + "/qemu-bridge/thalamus-vm-bridge.exe",
            appDir + "/../bridge/thalamus-vm-bridge.exe",
        };
        for (const QString &candidate : candidates) {
            if (QFile::exists(candidate)) {
                path = candidate;
                break;
            }
        }
    }

    if (path.isEmpty()) {
        emit bridgeError("VM bridge executable not found");
        return;
    }

    m_bridgeProcess = new QProcess(this);
    connect(m_bridgeProcess, &QProcess::started, this, &VMBridgeManager::onProcessStarted);
    connect(m_bridgeProcess, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this, &VMBridgeManager::onProcessFinished);
    connect(m_bridgeProcess, &QProcess::errorOccurred, this, &VMBridgeManager::onProcessError);

    m_bridgeProcess->start(path, QStringList());
}

bool VMBridgeManager::isBridgeProcessRunning() const
{
    return m_bridgeProcess && m_bridgeProcess->state() != QProcess::NotRunning;
}

void VMBridgeManager::sendCommand(const QJsonObject &cmd)
{
    if (!m_ws || m_ws->state() != QAbstractSocket::ConnectedState) return;
    m_ws->sendTextMessage(QJsonDocument(cmd).toJson(QJsonDocument::Compact));
}

void VMBridgeManager::onWsConnected()
{
    m_connectRetries = 0;
    emit bridgeConnected();

    // Ping to verify
    ping();
}

void VMBridgeManager::onWsDisconnected()
{
    emit bridgeDisconnected();
}

void VMBridgeManager::onWsTextMessage(const QString &message)
{
    QJsonDocument doc = QJsonDocument::fromJson(message.toUtf8());
    if (!doc.isObject()) return;

    QJsonObject msg = doc.object();
    QString status = msg["status"].toString();
    QString action = msg["action"].toString();

    if (action == "pong" || status == "pong") {
        handlePong(msg);
    } else if (status == "success") {
        handleBootResponse(msg);
    } else if (status == "error") {
        emit bridgeError(msg["message"].toString());
    } else if (action == "list") {
        emit vmListUpdated(msg["vms"].toArray());
    }

    emit bridgeStatus(msg);
}

void VMBridgeManager::onWsError(QAbstractSocket::SocketError error)
{
    Q_UNUSED(error);
    if (m_connectRetries < MAX_RETRIES) {
        m_connectRetries++;
        // Retry connection after delay
        QTimer::singleShot(2000 * m_connectRetries, this, [this]() {
            if (m_ws) m_ws->open(QUrl(m_bridgeUrl));
        });
    } else {
        emit bridgeError("Could not connect to VM bridge after " + QString::number(MAX_RETRIES) + " attempts");
    }
}

void VMBridgeManager::onProcessStarted()
{
    emit bridgeProcessStarted();
    // Now try WebSocket connection
    QTimer::singleShot(1000, this, [this]() {
        connectToBridge(m_bridgeUrl);
    });
}

void VMBridgeManager::onProcessFinished(int exitCode, QProcess::ExitStatus status)
{
    Q_UNUSED(status);
    emit bridgeProcessStopped(exitCode);
}

void VMBridgeManager::onProcessError(QProcess::ProcessError error)
{
    QString errorMsg;
    switch (error) {
        case QProcess::FailedToStart: errorMsg = "Bridge process failed to start"; break;
        case QProcess::Crashed: errorMsg = "Bridge process crashed"; break;
        case QProcess::Timedout: errorMsg = "Bridge process timed out"; break;
        default: errorMsg = "Bridge process error"; break;
    }
    emit bridgeError(errorMsg);
}

void VMBridgeManager::handlePong(const QJsonObject &msg)
{
    Q_UNUSED(msg);
    // Bridge is alive
}

void VMBridgeManager::handleBootResponse(const QJsonObject &msg)
{
    QString vmId = msg["vmId"].toString();
    int port = msg["vncPort"].toInt(m_vncPort);
    bool hasIso = msg["hasIso"].toBool();
    m_currentVmId = vmId;
    m_vncPort = port;
    emit vmBooted(vmId, port, hasIso);
}

void VMBridgeManager::handleStopResponse(const QJsonObject &msg)
{
    QString vmId = msg["vmId"].toString();
    emit vmStopped(vmId);
}
