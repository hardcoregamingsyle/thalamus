// Thalamus AI — VMBridgeManager.cpp
#include "VMBridgeManager.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QCoreApplication>
#include <QDir>

VMBridgeManager::VMBridgeManager(QObject *parent)
    : QObject(parent)
    , m_webSocket(new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this))
    , m_bridgeProcess(nullptr)
    , m_reconnectTimer(new QTimer(this))
    , m_bridgePath("thalamus-vm-bridge")
    , m_port(5900)
    , m_running(false)
{
    connect(m_webSocket, &QWebSocket::connected, this, &VMBridgeManager::onConnected);
    connect(m_webSocket, &QWebSocket::disconnected, this, &VMBridgeManager::onDisconnected);
    connect(m_webSocket, &QWebSocket::textMessageReceived, this, &VMBridgeManager::onTextMessageReceived);
    connect(m_webSocket, QOverload<QAbstractSocket::SocketError>::of(&QWebSocket::error),
            this, &VMBridgeManager::onError);
}

VMBridgeManager::~VMBridgeManager()
{
    stopVm();
}

void VMBridgeManager::bootVm(const QString &os, int ramMB, int cpuCores)
{
    QJsonObject params;
    params["os"] = os;
    params["ram_mb"] = ramMB;
    params["cpu_cores"] = cpuCores;
    sendCommand("boot", params);
}

void VMBridgeManager::stopVm()
{
    if (m_webSocket->state() == QAbstractSocket::ConnectedState) {
        sendCommand("stop");
        m_webSocket->close();
    }

    if (m_bridgeProcess && m_bridgeProcess->state() == QProcess::Running) {
        m_bridgeProcess->terminate();
        if (!m_bridgeProcess->waitForFinished(3000)) {
            m_bridgeProcess->kill();
        }
    }

    m_running = false;
    emit vmStopped();
}

bool VMBridgeManager::isRunning() const { return m_running; }

void VMBridgeManager::sendKeyboardEvent(bool down, quint32 keysym)
{
    QJsonObject params;
    params["down"] = down;
    params["keysym"] = static_cast<double>(keysym);
    sendCommand("keyboard", params);
}

void VMBridgeManager::sendPointerEvent(int x, int y, int buttonMask)
{
    QJsonObject params;
    params["x"] = x;
    params["y"] = y;
    params["button_mask"] = buttonMask;
    sendCommand("pointer", params);
}

QWebSocket *VMBridgeManager::webSocket() const { return m_webSocket; }

void VMBridgeManager::onConnected()
{
    if (!m_reconnectTimer->isActive())
        m_reconnectTimer->start(5000);
}

void VMBridgeManager::onDisconnected()
{
    m_running = false;
}

void VMBridgeManager::onTextMessageReceived(const QString &message)
{
    QJsonDocument doc = QJsonDocument::fromJson(message.toUtf8());
    QJsonObject msg = doc.object();
    QString type = msg["type"].toString();

    if (type == "booted") {
        m_running = true;
        emit vmBooted();
    } else if (type == "stopped") {
        m_running = false;
        emit vmStopped();
    } else if (type == "error") {
        emit error(msg["message"].toString());
    } else if (type == "framebuffer") {
        QByteArray fb = QByteArray::fromBase64(msg["data"].toString().toUtf8());
        emit vncFrameAvailable(fb);
    }
}

void VMBridgeManager::onError(QAbstractSocket::SocketError)
{
    emit error("WebSocket connection failed");
}

void VMBridgeManager::sendCommand(const QString &command, const QJsonObject &params)
{
    if (m_webSocket->state() != QAbstractSocket::ConnectedState) {
        // Auto-connect to local bridge
        m_webSocket->open(QUrl(QString("ws://localhost:%1").arg(m_port)));
        // Give it a moment, then send
        QTimer::singleShot(500, this, [this, command, params]() {
            if (m_webSocket->state() == QAbstractSocket::ConnectedState) {
                QJsonObject cmd;
                cmd["command"] = command;
                if (!params.isEmpty()) cmd["params"] = params;
                m_webSocket->sendTextMessage(
                    QString::fromUtf8(QJsonDocument(cmd).toJson(QJsonDocument::Compact)));
            }
        });
    } else {
        QJsonObject cmd;
        cmd["command"] = command;
        if (!params.isEmpty()) cmd["params"] = params;
        m_webSocket->sendTextMessage(
            QString::fromUtf8(QJsonDocument(cmd).toJson(QJsonDocument::Compact)));
    }
}
