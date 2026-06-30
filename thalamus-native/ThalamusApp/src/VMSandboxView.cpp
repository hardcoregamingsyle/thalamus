// Thalamus AI — VMSandboxView.cpp
#include "VMSandboxView.h"
#include "ConvexClient.h"
#include "VMBridgeManager.h"
#include "VNCWidget.h"
#include <QHBoxLayout>
#include <QGroupBox>
#include <QVBoxLayout>
#include <QFrame>

VMSandboxView::VMSandboxView(ConvexClient *client, QWidget *parent)
    : QWidget(parent), m_client(client)
    , m_bridgeManager(new VMBridgeManager(this))
    , m_vncWidget(nullptr), m_vmRunning(false)
{
    setupUi();
    connect(m_bridgeManager, &VMBridgeManager::vmBooted, this, &VMSandboxView::onVMBooted);
    connect(m_bridgeManager, &VMBridgeManager::vmStopped, this, &VMSandboxView::onVMStopped);
    connect(m_bridgeManager, &VMBridgeManager::error, this, &VMSandboxView::onVMError);
}

void VMSandboxView::setupUi()
{
    auto *l = new QVBoxLayout(this); l->setSpacing(8); l->setContentsMargins(16,16,16,16);
    auto *h = new QLabel("VM Sandbox");
    h->setStyleSheet("font-size:18px; font-weight:bold; color:#c0c0f0;");
    l->addWidget(h);
    auto *d = new QLabel("Boot a virtual machine with embedded VNC viewer.");
    d->setWordWrap(true); d->setStyleSheet("color:#8080a0; font-size:13px; margin-bottom:8px;");
    l->addWidget(d);

    m_configPanel = new QWidget;
    auto *cl = new QHBoxLayout(m_configPanel); cl->setSpacing(16);

    auto *og = new QGroupBox("OS"); og->setStyleSheet(
        "QGroupBox { color:#a0a0c0; border:1px solid #2e2e4e; border-radius:6px; padding:12px; padding-top:20px; font-size:13px; }"
        "QGroupBox::title { subcontrol-origin:margin; left:12px; padding:0 4px; }");
    auto *ol = new QVBoxLayout(og);
    m_osSelector = new QComboBox;
    m_osSelector->addItems({"Windows 11","Ubuntu 24.04","Fedora 40","macOS 15","Android 14"});
    m_osSelector->setStyleSheet(
        "QComboBox { padding:8px; border:1px solid #3e3e5e; border-radius:6px; "
        "background:#16162a; color:#e0e0f0; font-size:13px; }"
        "QComboBox::drop-down { border:none; }"
        "QComboBox QAbstractItemView { background:#1e1e32; color:#e0e0f0; selection-background-color:#2a2a4a; }");
    ol->addWidget(m_osSelector); cl->addWidget(og);

    auto *rg = new QGroupBox("RAM"); rg->setStyleSheet(og->styleSheet());
    auto *rl = new QVBoxLayout(rg);
    m_ramSpinBox = new QSpinBox; m_ramSpinBox->setRange(1024,16384); m_ramSpinBox->setValue(4096);
    m_ramSpinBox->setSuffix(" MB"); m_ramSpinBox->setSingleStep(1024);
    m_ramSpinBox->setStyleSheet("QSpinBox { padding:8px; border:1px solid #3e3e5e; border-radius:6px; background:#16162a; color:#e0e0f0; font-size:13px; }");
    rl->addWidget(m_ramSpinBox); cl->addWidget(rg);

    auto *cg = new QGroupBox("CPU"); cg->setStyleSheet(og->styleSheet());
    auto *cl2 = new QVBoxLayout(cg);
    m_cpuSpinBox = new QSpinBox; m_cpuSpinBox->setRange(1,16); m_cpuSpinBox->setValue(4);
    m_cpuSpinBox->setStyleSheet(m_ramSpinBox->styleSheet());
    cl2->addWidget(m_cpuSpinBox); cl->addWidget(cg);

    auto *ag = new QGroupBox("Actions"); ag->setStyleSheet(og->styleSheet());
    auto *al3 = new QVBoxLayout(ag);
    m_bootButton = new QPushButton("Boot VM");
    m_bootButton->setCursor(Qt::PointingHandCursor);
    m_bootButton->setStyleSheet(
        "QPushButton { padding:10px 20px; border:none; border-radius:6px; "
        "background:#4aaf4a; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#5abf5a; }");
    connect(m_bootButton, &QPushButton::clicked, this, &VMSandboxView::onBootVM);
    al3->addWidget(m_bootButton);
    m_stopButton = new QPushButton("Stop VM");
    m_stopButton->setCursor(Qt::PointingHandCursor); m_stopButton->setEnabled(false);
    m_stopButton->setStyleSheet(
        "QPushButton { padding:10px 20px; border:none; border-radius:6px; "
        "background:#ff4a4a; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#ff5a5a; }"
        "QPushButton:disabled { background:#2a2a4a; color:#606080; }");
    connect(m_stopButton, &QPushButton::clicked, this, &VMSandboxView::onStopVM);
    al3->addWidget(m_stopButton); cl->addWidget(ag);
    l->addWidget(m_configPanel);

    m_statusLabel = new QLabel("VM not running");
    m_statusLabel->setStyleSheet("color:#8080a0; font-size:12px; padding:4px 0;");
    l->addWidget(m_statusLabel);

    m_displayPanel = new QWidget;
    auto *dl = new QVBoxLayout(m_displayPanel); dl->setContentsMargins(0,0,0,0);
    m_vncWidget = new VNCWidget(m_bridgeManager, this);
    dl->addWidget(m_vncWidget, 1);
    m_displayPanel->hide();
    l->addWidget(m_displayPanel, 1);
}

void VMSandboxView::onBootVM()
{
    setVmState(true);
    m_statusLabel->setText(QString("Booting %1...").arg(m_osSelector->currentText()));
    m_bridgeManager->bootVm(m_osSelector->currentText(), m_ramSpinBox->value(), m_cpuSpinBox->value());
}

void VMSandboxView::onStopVM() { m_bridgeManager->stopVm(); }
void VMSandboxView::onVMBooted() {
    m_statusLabel->setText("VM running"); m_configPanel->hide();
    m_displayPanel->show(); m_vncWidget->start();
}
void VMSandboxView::onVMStopped() { setVmState(false); m_statusLabel->setText("VM stopped"); m_configPanel->show(); m_displayPanel->hide(); m_vncWidget->stop(); }
void VMSandboxView::onVMError(const QString &error) { setVmState(false); m_statusLabel->setText("Error: "+error); m_statusLabel->setStyleSheet("color:#ff4a4a; font-size:12px; padding:4px 0;"); }
void VMSandboxView::setVmState(bool r) { m_vmRunning=r; m_bootButton->setEnabled(!r); m_stopButton->setEnabled(r); m_osSelector->setEnabled(!r); m_ramSpinBox->setEnabled(!r); m_cpuSpinBox->setEnabled(!r); }
