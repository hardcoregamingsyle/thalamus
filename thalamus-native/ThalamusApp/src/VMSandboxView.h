// Thalamus AI — VMSandboxView.h
#pragma once

#include <QWidget>
#include <QComboBox>
#include <QSpinBox>
#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>

class ConvexClient;
class VMBridgeManager;
class VNCWidget;

class VMSandboxView : public QWidget
{
    Q_OBJECT

public:
    explicit VMSandboxView(ConvexClient *client, QWidget *parent = nullptr);
    ~VMSandboxView() = default;

private slots:
    void onBootVM();
    void onStopVM();
    void onVMBooted();
    void onVMStopped();
    void onVMError(const QString &error);

private:
    void setupUi();
    void setVmState(bool running);

    ConvexClient *m_client;
    VMBridgeManager *m_bridgeManager;
    VNCWidget *m_vncWidget;

    // VM config
    QComboBox *m_osSelector;
    QSpinBox *m_ramSpinBox;
    QSpinBox *m_cpuSpinBox;

    // Controls
    QPushButton *m_bootButton;
    QPushButton *m_stopButton;
    QLabel *m_statusLabel;
    QWidget *m_configPanel;
    QWidget *m_displayPanel;

    bool m_vmRunning;
};
