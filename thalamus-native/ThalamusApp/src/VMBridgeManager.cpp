// Thalamus AI — VMBridgeManager.cpp
#include "VMBridgeManager.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QCoreApplication>
#include <QDir>

VMBridgeManager::VMBridgeManager(QObject *parent)
    : QObject(parent)
    , m_webSocket(new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this))
    , m_bridgeProcess(nullptr), m_port(5900), m_running(false)
{
    connect(m_webSocket, &QWebSocket::connected, this, &VMBridgeManager::onConnected);
    connect(m_webSocket, &QWebSocket::disconnected, this, &VMBridgeManager::onDisconnected);
    connect(m_webSocket, &QWebSocket::textMessageReceived, this, &VMBridgeManager::onTextMessageReceived);
    connect(m_webSocket, QOverload<QAbstractSocket::SocketError>::of(&QWebSocket::error),
            this, &VMBridgeManager::onError);
}

VMBridgeManager::~VMBridgeManager() { stopVm(); }

void VMBridgeManager::bootVm(const QString &os, int ramMB, int cpuCores)
{
    QJsonObject p; p["os"]=os; p["ram_mb"]=ramMB; p["cpu_cores"]=cpuCores;
    sendCommand("boot", p);
}

void VMBridgeManager::stopVm()
{
    if (m_webSocket->state() == QAbstractSocket::ConnectedState) {
        sendCommand("stop"); m_webSocket->close();
    }
    if (m_bridgeProcess && m_bridgeProcess->state() == QProcess::Running) {
        m_bridgeProcess->terminate();
        if (!m_bridgeProcess->waitForFinished(3000)) m_bridgeProcess->kill();
    }
    m_running = false; emit vmStopped();
}

bool VMBridgeManager::isRunning() const { return m_running; }
void VMBridgeManager::sendKeyboardEvent(bool down, quint32 keysym) {
    QJsonObject p; p["down"]=down; p["keysym"]=static_cast<double>(keysym);
    sendCommand("keyboard", p);
}
void VMBridgeManager::sendPointerEvent(int x, int y, int buttonMask) {
    QJsonObject p; p["x"]=x; p["y"]=y; p["button_mask"]=buttonMask;
    sendCommand("pointer", p);
}
QWebSocket *VMBridgeManager::webSocket() const { return m_webSocket; }

void VMBridgeManager::onConnected() {}
void VMBridgeManager::onDisconnected() { m_running = false; }
void VMBridgeManager::onTextMessageReceived(const QString &message)
{
    QJsonObject msg = QJsonDocument::fromJson(message.toUtf8()).object();
    QString t = msg["type"].toString();
    if (t=="booted") { m_running=true; emit vmBooted(); }
    else if (t=="stopped") { m_running=false; emit vmStopped(); }
    else if (t=="error") { emit error(msg["message"].toString()); }
}

void VMBridgeManager::onError(QAbstractSocket::SocketError)
{ emit error("WebSocket connection failed"); }

void VMBridgeManager::sendCommand(const QString &command, const QJsonObject &params)
{
    if (m_webSocket->state() != QAbstractSocket::ConnectedState) {
        m_webSocket->open(QUrl(QString("ws://localhost:%1").arg(m_port)));
        QTimer::singleShot(500, this, [this, command, params]() {
            if (m_webSocket->state() == QAbstractSocket::ConnectedState) {
                QJsonObject cmd; cmd["command"]=command;
                if (!params.isEmpty()) cmd["params"]=params;
                m_webSocket->sendTextMessage(QString::fromUtf8(
                    QJsonDocument(cmd).toJson(QJsonDocument::Compact)));
            }
        });
    } else {
        QJsonObject cmd; cmd["command"]=command;
        if (!params.isEmpty()) cmd["params"]=params;
        m_webSocket->sendTextMessage(QString::fromUtf8(
            QJsonDocument(cmd).toJson(QJsonDocument::Compact)));
    }
}
