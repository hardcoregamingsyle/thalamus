#ifndef VMBRIDGEMANAGER_H
#define VMBRIDGEMANAGER_H

#include <QObject>
#include <QProcess>
#include <QString>
#include <QJsonObject>
#include <QTimer>
#include <QWebSocket>

/**
 * @brief Manages the local QEMU VM bridge process and WebSocket communication.
 *
 * Handles:
 * - Launching QEMU processes for VMs
 * - Connecting to the VM bridge WebSocket (port 5900)
 * - VM lifecycle (boot, stop, pause, resume)
 * - VNC port negotiation
 * - ISO/disk image management
 */
class VMBridgeManager : public QObject
{
    Q_OBJECT

public:
    explicit VMBridgeManager(QObject *parent = nullptr);
    ~VMBridgeManager();

    /// Check if bridge WebSocket is connected
    bool isConnected() const;

    /// Connect to the VM bridge
    void connectToBridge(const QString &url = "ws://localhost:5900");

    /// Disconnect from bridge
    void disconnectFromBridge();

    /// Boot a new VM
    void bootVM(const QString &os, int ramMB, int cores);

    /// Stop a running VM
    void stopVM(const QString &vmId);

    /// List active VMs
    void listVMs();

    /// Ping the bridge
    void ping();

    /// Launch the bridge executable if bundled
    void launchBridgeProcess(const QString &bridgePath);

    /// Get VNC port for a VM
    int vncPort() const { return m_vncPort; }

    /// Get bridge process status
    bool isBridgeProcessRunning() const;

signals:
    void bridgeConnected();
    void bridgeDisconnected();
    void bridgeError(const QString &error);
    void bridgeStatus(const QJsonObject &status);
    void vmBooted(const QString &vmId, int vncPort, bool hasIso);
    void vmStopped(const QString &vmId);
    void vmListUpdated(const QJsonArray &vms);
    void bridgeProcessStarted();
    void bridgeProcessStopped(int exitCode);

private slots:
    void onWsConnected();
    void onWsDisconnected();
    void onWsTextMessage(const QString &message);
    void onWsError(QAbstractSocket::SocketError error);
    void onProcessStarted();
    void onProcessFinished(int exitCode, QProcess::ExitStatus status);
    void onProcessError(QProcess::ProcessError error);

private:
    void sendCommand(const QJsonObject &cmd);
    void handlePong(const QJsonObject &msg);
    void handleBootResponse(const QJsonObject &msg);
    void handleStopResponse(const QJsonObject &msg);

    QWebSocket *m_ws;
    QProcess *m_bridgeProcess;
    QString m_bridgeUrl;
    QString m_currentVmId;
    int m_vncPort;
    int m_connectRetries;
    static const int MAX_RETRIES = 5;
};

#endif // VMBRIDGEMANAGER_H
