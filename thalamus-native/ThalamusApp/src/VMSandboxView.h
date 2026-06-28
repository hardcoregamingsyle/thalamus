#ifndef VMSANDBOXVIEW_H
#define VMSANDBOXVIEW_H

#include <QWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QLabel>
#include <QComboBox>
#include <QSlider>
#include <QSpinBox>
#include <QScrollArea>
#include <QGroupBox>
#include <QJsonObject>
#include "ConvexClient.h"
#include "VNCWidget.h"
#include "VMBridgeManager.h"

/**
 * @brief VM Sandbox — full OS virtualisation via QEMU.
 *
 * Features:
 * - OS selector (Windows 11, Ubuntu, macOS, Android, etc.)
 * - RAM/CPU configuration sliders
 * - VM lifecycle (boot, stop, pause, resume)
 * - Embedded VNC viewer
 * - ISO/disk download management
 * - Bridge connection status
 */
class VMSandboxView : public QWidget
{
    Q_OBJECT

public:
    explicit VMSandboxView(ConvexClient *client, QWidget *parent = nullptr);
    ~VMSandboxView();

    void handleBridgeMessage(const QJsonObject &msg);

private slots:
    void onBootVM();
    void onStopVM();
    void onPauseVM();
    void onConnectBridge();
    void onDisconnectBridge();
    void onDownloadISO();
    void onOSChanged(int index);
    void onBridgeConnected();
    void onBridgeDisconnected();
    void onBridgeError(const QString &error);
    void onVMBooted(const QString &vmId, int vncPort, bool hasIso);
    void onVMStopped(const QString &vmId);

private:
    void setupUI();
    void updateUIState();
    void loadOSTemplates();
    void loadOSConfig(const QString &os);
    QString osDescription(const QString &os);

    ConvexClient *m_client;
    VMBridgeManager *m_bridge;

    // UI — Controls
    QComboBox *m_osCombo;
    QSlider *m_ramSlider;
    QSlider *m_cpuSlider;
    QSpinBox *m_ramValue;
    QSpinBox *m_cpuValue;
    QPushButton *m_bootBtn;
    QPushButton *m_stopBtn;
    QPushButton *m_pauseBtn;
    QPushButton *m_connectBtn;
    QPushButton *m_disconnectBtn;
    QPushButton *m_downloadBtn;
    QLabel *m_bridgeStatus;
    QLabel *m_vmStatus;
    QLabel *m_osInfo;

    // UI — VNC
    VNCWidget *m_vncDisplay;

    // VM State
    QString m_currentVmId;
    int m_currentVncPort;
    bool m_vmRunning;
    bool m_vmPaused;
    bool m_bridgeConnected;
    bool m_hasIso;

    // OS config
    struct OSConfig {
        QString label;
        int minRam;
        int recommendedRam;
        int minCores;
        QString description;
    };
    QMap<QString, OSConfig> m_osConfigs;
};

#endif // VMSANDBOXVIEW_H
