// Thalamus AI — VMSandboxView.cpp
#include "VMSandboxView.h"
#include "ConvexClient.h"
#include "VMBridgeManager.h"
#include "VNCWidget.h"
#include "OSSelectorDialog.h"
#include <QHBoxLayout>
#include <QGroupBox>
#include <QFormLayout>
#include <QFrame>

VMSandboxView::VMSandboxView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_bridgeManager(new VMBridgeManager(this))
    , m_vmRunning(false)
{
    setupUi();
    connect(m_bridgeManager, &VMBridgeManager::vmBooted, this, &VMSandboxView::onVMBooted);
    connect(m_bridgeManager, &VMBridgeManager::vmStopped, this, &VMSandboxView::onVMStopped);
    connect(m_bridgeManager, &VMBridgeManager::error, this, &VMSandboxView::onVMError);
}

void VMSandboxView::setupUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(8);
    layout->setContentsMargins(16, 16, 16, 16);

    auto *header = new QLabel("VM Sandbox");
    header->setStyleSheet("font-size: 18px; font-weight: bold; color: #c0c0f0;");
    layout->addWidget(header);

    auto *description = new QLabel(
        "Boot a virtual machine in the cloud sandbox. "
        "Choose your OS, configure resources, and access it via the embedded VNC viewer.");
    description->setWordWrap(true);
    description->setStyleSheet("color: #8080a0; font-size: 13px; margin-bottom: 8px;");
    layout->addWidget(description);

    // Config panel
    m_configPanel = new QWidget;
    auto *configLayout = new QHBoxLayout(m_configPanel);
    configLayout->setSpacing(16);

    // OS selector
    auto *osGroup = new QGroupBox("Operating System");
    osGroup->setStyleSheet(
        "QGroupBox { color: #a0a0c0; border: 1px solid #2e2e4e; border-radius: 6px; "
        "padding: 12px; padding-top: 20px; font-size: 13px; }"
        "QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 4px; }");
    auto *osLayout = new QVBoxLayout(osGroup);
    m_osSelector = new QComboBox;
    m_osSelector->addItems({"Windows 11", "Ubuntu 24.04", "Fedora 40", "macOS 15", "Android 14"});
    m_osSelector->setStyleSheet(
        "QComboBox { padding: 8px; border: 1px solid #3e3e5e; border-radius: 6px; "
        "background: #16162a; color: #e0e0f0; font-size: 13px; }"
        "QComboBox::drop-down { border: none; }"
        "QComboBox QAbstractItemView { background: #1e1e32; color: #e0e0f0; "
        "selection-background-color: #2a2a4a; }");
    osLayout->addWidget(m_osSelector);
    configLayout->addWidget(osGroup);

    // RAM
    auto *ramGroup = new QGroupBox("RAM");
    ramGroup->setStyleSheet(osGroup->styleSheet());
    auto *ramLayout = new QVBoxLayout(ramGroup);
    m_ramSpinBox = new QSpinBox;
    m_ramSpinBox->setRange(1024, 16384);
    m_ramSpinBox->setValue(4096);
    m_ramSpinBox->setSuffix(" MB");
    m_ramSpinBox->setSingleStep(1024);
    m_ramSpinBox->setStyleSheet(
        "QSpinBox { padding: 8px; border: 1px solid #3e3e5e; border-radius: 6px; "
        "background: #16162a; color: #e0e0f0; font-size: 13px; }");
    ramLayout->addWidget(m_ramSpinBox);
    configLayout->addWidget(ramGroup);

    // CPU cores
    auto *cpuGroup = new QGroupBox("CPU Cores");
    cpuGroup->setStyleSheet(osGroup->styleSheet());
    auto *cpuLayout = new QVBoxLayout(cpuGroup);
    m_cpuSpinBox = new QSpinBox;
    m_cpuSpinBox->setRange(1, 16);
    m_cpuSpinBox->setValue(4);
    m_cpuSpinBox->setStyleSheet(m_ramSpinBox->styleSheet());
    cpuLayout->addWidget(m_cpuSpinBox);
    configLayout->addWidget(cpuGroup);

    // Boot/Stop buttons
    auto *actionGroup = new QGroupBox("Actions");
    actionGroup->setStyleSheet(osGroup->styleSheet());
    auto *actionLayout = new QVBoxLayout(actionGroup);

    m_bootButton = new QPushButton("Boot VM");
    m_bootButton->setCursor(Qt::PointingHandCursor);
    m_bootButton->setStyleSheet(
        "QPushButton { padding: 10px 20px; border: none; border-radius: 6px; "
        "background: #4aaf4a; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #5abf5a; }");
    connect(m_bootButton, &QPushButton::clicked, this, &VMSandboxView::onBootVM);
    actionLayout->addWidget(m_bootButton);

    m_stopButton = new QPushButton("Stop VM");
    m_stopButton->setCursor(Qt::PointingHandCursor);
    m_stopButton->setEnabled(false);
    m_stopButton->setStyleSheet(
        "QPushButton { padding: 10px 20px; border: none; border-radius: 6px; "
        "background: #ff4a4a; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #ff5a5a; }"
        "QPushButton:disabled { background: #2a2a4a; color: #606080; }");
    connect(m_stopButton, &QPushButton::clicked, this, &VMSandboxView::onStopVM);
    actionLayout->addWidget(m_stopButton);

    configLayout->addWidget(actionGroup);
    layout->addWidget(m_configPanel);

    // Status
    m_statusLabel = new QLabel("VM not running");
    m_statusLabel->setStyleSheet("color: #8080a0; font-size: 12px; padding: 4px 0;");
    layout->addWidget(m_statusLabel);

    // VNC display panel
    m_displayPanel = new QWidget;
    auto *displayLayout = new QVBoxLayout(m_displayPanel);
    displayLayout->setContentsMargins(0, 0, 0, 0);

    m_vncWidget = new VNCWidget(m_bridgeManager, this);
    displayLayout->addWidget(m_vncWidget, 1);

    m_displayPanel->hide();
    layout->addWidget(m_displayPanel, 1);
}

void VMSandboxView::onBootVM()
{
    setVmState(true);
    QString os = m_osSelector->currentText();
    int ram = m_ramSpinBox->value();
    int cpu = m_cpuSpinBox->value();

    m_statusLabel->setText(QString("Booting %1 (%2 MB, %3 cores)...")
        .arg(os).arg(ram).arg(cpu));
    m_bridgeManager->bootVm(os, ram, cpu);
}

void VMSandboxView::onStopVM()
{
    m_bridgeManager->stopVm();
}

void VMSandboxView::onVMBooted()
{
    m_statusLabel->setText("VM running \u2014 connected via VNC");
    m_configPanel->hide();
    m_displayPanel->show();
    m_vncWidget->start();
}

void VMSandboxView::onVMStopped()
{
    setVmState(false);
    m_statusLabel->setText("VM stopped");
    m_configPanel->show();
    m_displayPanel->hide();
    m_vncWidget->stop();
}

void VMSandboxView::onVMError(const QString &error)
{
    setVmState(false);
    m_statusLabel->setText("Error: " + error);
    m_statusLabel->setStyleSheet("color: #ff4a4a; font-size: 12px; padding: 4px 0;");
}

void VMSandboxView::setVmState(bool running)
{
    m_vmRunning = running;
    m_bootButton->setEnabled(!running);
    m_stopButton->setEnabled(running);
    m_osSelector->setEnabled(!running);
    m_ramSpinBox->setEnabled(!running);
    m_cpuSpinBox->setEnabled(!running);
}
