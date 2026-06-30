// Thalamus AI — VMBridgeManager.h
#pragma once

#include <QObject>
#include <QWebSocket>
#include <QProcess>
#include <QUrl>
#include <QTimer>

class VMBridgeManager : public QObject
{
    Q_OBJECT

public:
    explicit VMBridgeManager(QObject *parent = nullptr);
    ~VMBridgeManager();

    void bootVm(const QString &os, int ramMB, int cpuCores);
    void stopVm();
    bool isRunning() const;

    void sendKeyboardEvent(bool down, quint32 keysym);
    void sendPointerEvent(int x, int y, int buttonMask);

    QWebSocket *webSocket() const;

signals:
    void vmBooted();
    void vmStopped();
    void vncFrameAvailable(const QByteArray &framebuffer);
    void error(const QString &message);

private slots:
    void onConnected();
    void onDisconnected();
    void onTextMessageReceived(const QString &message);
    void onError(QAbstractSocket::SocketError error);

private:
    void sendCommand(const QString &command, const QJsonObject &params = QJsonObject());

    QWebSocket *m_webSocket;
    QProcess *m_bridgeProcess;
    QTimer *m_reconnectTimer;
    QString m_bridgePath;
    int m_port;
    bool m_running;
};
