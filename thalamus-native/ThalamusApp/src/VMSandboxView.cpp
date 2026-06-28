#include "VMSandboxView.h"
#include "OSSelectorDialog.h"
#include <QGridLayout>
#include <QFrame>
#include <QMessageBox>
#include <QFileDialog>
#include <QProcess>
#include <QDesktopServices>
#include <QUrl>

VMSandboxView::VMSandboxView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_bridge(new VMBridgeManager(this))
    , m_vmRunning(false)
    , m_vmPaused(false)
    , m_bridgeConnected(false)
    , m_hasIso(false)
{
    loadOSTemplates();
    setupUI();

    connect(m_bridge, &VMBridgeManager::bridgeConnected, this, &VMSandboxView::onBridgeConnected);
    connect(m_bridge, &VMBridgeManager::bridgeDisconnected, this, &VMSandboxView::onBridgeDisconnected);
    connect(m_bridge, &VMBridgeManager::bridgeError, this, &VMSandboxView::onBridgeError);
    connect(m_bridge, &VMBridgeManager::vmBooted, this, &VMSandboxView::onVMBooted);
    connect(m_bridge, &VMBridgeManager::vmStopped, this, &VMSandboxView::onVMStopped);
}

VMSandboxView::~VMSandboxView() {}

void VMSandboxView::loadOSTemplates()
{
    m_osConfigs = {
        {"windows-11", {"Windows 11 Pro", 4096, 8192, 2, "64-bit QEMU VM with TPM 2.0, Secure Boot, and UEFI"}},
        {"windows-10", {"Windows 10 Pro", 2048, 4096, 2, "64-bit QEMU VM with UEFI and Secure Boot"}},
        {"ubuntu-24", {"Ubuntu 24.04 LTS", 2048, 4096, 2, "64-bit QEMU VM with SPICE display"}},
        {"ubuntu-22", {"Ubuntu 22.04 LTS", 2048, 2048, 2, "64-bit QEMU VM"}},
        {"fedora-40", {"Fedora 40 Workstation", 2048, 4096, 2, "64-bit QEMU VM"}},
        {"debian-12", {"Debian 12 Bookworm", 1024, 2048, 1, "64-bit QEMU VM"}},
        {"macos-sequoia", {"macOS 15 Sequoia", 4096, 8192, 2, "Experimental QEMU HVF acceleration"}},
        {"android-14", {"Android 14 x86_64", 2048, 4096, 2, "Android x86_64 QEMU VM"}},
        {"alpine", {"Alpine Linux", 512, 1024, 1, "Lightweight 64-bit QEMU VM"}},
        {"freedos", {"FreeDOS", 64, 128, 1, "16-bit legacy QEMU VM"}},
    };
}

QString VMSandboxView::osDescription(const QString &os)
{
    auto it = m_osConfigs.find(os);
    if (it != m_osConfigs.end()) return it->description;
    return "";
}

void VMSandboxView::setupUI()
{
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(16, 16, 16, 16);
    mainLayout->setSpacing(12);

    // ── Header ─────────────────────────────────────────────────────────────
    auto *header = new QLabel("🖥️  VM Sandbox");
    header->setStyleSheet("font-size: 22px; font-weight: 700; color: #fff;");

    auto *subtitle = new QLabel("Boot full operating systems with hardware-accelerated QEMU virtualisation");
    subtitle->setStyleSheet("font-size: 12px; color: #888;");
    subtitle->setWordWrap(true);

    mainLayout->addWidget(header);
    mainLayout->addWidget(subtitle);

    // ── Control panel ──────────────────────────────────────────────────────
    auto *controlPanel = new QWidget();
    controlPanel->setStyleSheet("background: #1a1a1a; border-radius: 12px; padding: 16px;");
    auto *ctlGrid = new QGridLayout(controlPanel);
    ctlGrid->setSpacing(12);

    // Row 0: OS selector
    auto *osLabel = new QLabel("Operating System");
    osLabel->setStyleSheet("font-size: 11px; font-weight: 600; color: #888;");

    m_osCombo = new QComboBox();
    m_osCombo->setStyleSheet(
        "QComboBox { background: #0d0d0d; border: 1px solid #333; border-radius: 8px;"
        "  padding: 10px; font-size: 13px; color: #fff; min-height: 20px; }"
        "QComboBox::drop-down { border: none; }"
        "QComboBox:hover { border-color: #a78bfa; }"
        "QComboBox QAbstractItemView { background: #1a1a1a; color: #fff; border: 1px solid #333; }"
    );
    // Populate OS list
    for (auto it = m_osConfigs.begin(); it != m_osConfigs.end(); ++it) {
        m_osCombo->addItem(it->label, it.key());
    }

    m_osInfo = new QLabel();
    m_osInfo->setStyleSheet("font-size: 11px; color: #666; padding: 4px 0;");
    m_osInfo->setWordWrap(true);

    ctlGrid->addWidget(osLabel, 0, 0);
    ctlGrid->addWidget(m_osCombo, 0, 1);
    ctlGrid->addWidget(m_osInfo, 1, 0, 1, 2);

    // Row 2: RAM slider
    auto *ramLabel = new QLabel("RAM");
    ramLabel->setStyleSheet("font-size: 11px; font-weight: 600; color: #888;");

    m_ramSlider = new QSlider(Qt::Horizontal);
    m_ramSlider->setRange(512, 16384);
    m_ramSlider->setValue(4096);
    m_ramSlider->setTickPosition(QSlider::TicksBelow);
    m_ramSlider->setTickInterval(1024);
    m_ramSlider->setStyleSheet(
        "QSlider::groove:horizontal { background: #2a2a2a; height: 6px; border-radius: 3px; }"
        "QSlider::handle:horizontal { background: #a78bfa; width: 18px; height: 18px; margin: -6px 0; border-radius: 9px; }"
        "QSlider::sub-page:horizontal { background: #a78bfa; border-radius: 3px; }"
    );

    m_ramValue = new QSpinBox();
    m_ramValue->setRange(512, 16384);
    m_ramValue->setValue(4096);
    m_ramValue->setSuffix(" MB");
    m_ramValue->setSingleStep(512);
    m_ramValue->setStyleSheet(
        "QSpinBox { background: #0d0d0d; border: 1px solid #333; border-radius: 6px;"
        "  padding: 6px; font-size: 12px; color: #fff; min-width: 90px; }"
    );

    connect(m_ramSlider, &QSlider::valueChanged, m_ramValue, &QSpinBox::setValue);
    connect(m_ramValue, QOverload<int>::of(&QSpinBox::valueChanged), m_ramSlider, &QSlider::setValue);

    ctlGrid->addWidget(ramLabel, 2, 0);
    auto *ramLayout = new QHBoxLayout();
    ramLayout->addWidget(m_ramSlider);
    ramLayout->addWidget(m_ramValue);
    ctlGrid->addLayout(ramLayout, 2, 1);

    // Row 3: CPU cores
    auto *cpuLabel = new QLabel("CPU Cores");
    cpuLabel->setStyleSheet("font-size: 11px; font-weight: 600; color: #888;");

    m_cpuSlider = new QSlider(Qt::Horizontal);
    m_cpuSlider->setRange(1, 16);
    m_cpuSlider->setValue(4);
    m_cpuSlider->setTickPosition(QSlider::TicksBelow);
    m_cpuSlider->setTickInterval(1);
    m_cpuSlider->setStyleSheet(
        "QSlider::groove:horizontal { background: #2a2a2a; height: 6px; border-radius: 3px; }"
        "QSlider::handle:horizontal { background: #a78bfa; width: 18px; height: 18px; margin: -6px 0; border-radius: 9px; }"
        "QSlider::sub-page:horizontal { background: #a78bfa; border-radius: 3px; }"
    );

    m_cpuValue = new QSpinBox();
    m_cpuValue->setRange(1, 16);
    m_cpuValue->setValue(4);
    m_cpuValue->setStyleSheet(
        "QSpinBox { background: #0d0d0d; border: 1px solid #333; border-radius: 6px;"
        "  padding: 6px; font-size: 12px; color: #fff; min-width: 90px; }"
    );

    connect(m_cpuSlider, &QSlider::valueChanged, m_cpuValue, &QSpinBox::setValue);
    connect(m_cpuValue, QOverload<int>::of(&QSpinBox::valueChanged), m_cpuSlider, &QSlider::setValue);

    ctlGrid->addWidget(cpuLabel, 3, 0);
    auto *cpuLayout = new QHBoxLayout();
    cpuLayout->addWidget(m_cpuSlider);
    cpuLayout->addWidget(m_cpuValue);
    ctlGrid->addLayout(cpuLayout, 3, 1);

    // Row 4: Action buttons
    auto *btnLayout = new QHBoxLayout();
    btnLayout->setSpacing(8);

    m_connectBtn = new QPushButton("🔗  Connect Bridge");
    m_connectBtn->setCursor(Qt::PointingHandCursor);
    m_connectBtn->setStyleSheet(
        "QPushButton { background: #a78bfa; color: #fff; border: none; border-radius: 8px;"
        "  padding: 10px 16px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #8b6ff0; }"
    );

    m_disconnectBtn = new QPushButton("✕  Disconnect");
    m_disconnectBtn->setVisible(false);
    m_disconnectBtn->setCursor(Qt::PointingHandCursor);
    m_disconnectBtn->setStyleSheet(
        "QPushButton { background: #ff6b6b; color: #fff; border: none; border-radius: 8px;"
        "  padding: 10px 16px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #e05555; }"
    );

    m_bootBtn = new QPushButton("▶  Boot VM");
    m_bootBtn->setCursor(Qt::PointingHandCursor);
    m_bootBtn->setEnabled(false);
    m_bootBtn->setStyleSheet(
        "QPushButton { background: #51cf66; color: #fff; border: none; border-radius: 8px;"
        "  padding: 10px 24px; font-size: 13px; font-weight: 700; }"
        "QPushButton:hover { background: #40c057; }"
        "QPushButton:disabled { background: #333; color: #555; }"
    );

    m_stopBtn = new QPushButton("⏹  Stop VM");
    m_stopBtn->setVisible(false);
    m_stopBtn->setCursor(Qt::PointingHandCursor);
    m_stopBtn->setStyleSheet(
        "QPushButton { background: #ff6b6b; color: #fff; border: none; border-radius: 8px;"
        "  padding: 10px 16px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #e05555; }"
    );

    m_pauseBtn = new QPushButton("⏸  Pause");
    m_pauseBtn->setVisible(false);
    m_pauseBtn->setCursor(Qt::PointingHandCursor);
    m_pauseBtn->setStyleSheet(
        "QPushButton { background: #ffd43b; color: #000; border: none; border-radius: 8px;"
        "  padding: 10px 16px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #fcc419; }"
    );

    m_downloadBtn = new QPushButton("⬇  Download ISO");
    m_downloadBtn->setCursor(Qt::PointingHandCursor);
    m_downloadBtn->setStyleSheet(
        "QPushButton { background: transparent; color: #a78bfa; border: 1px solid #a78bfa44; border-radius: 8px;"
        "  padding: 10px 16px; font-size: 11px; }"
        "QPushButton:hover { background: #a78bfa11; }"
    );

    btnLayout->addWidget(m_connectBtn);
    btnLayout->addWidget(m_disconnectBtn);
    btnLayout->addWidget(m_bootBtn);
    btnLayout->addWidget(m_stopBtn);
    btnLayout->addWidget(m_pauseBtn);
    btnLayout->addStretch();
    btnLayout->addWidget(m_downloadBtn);
    ctlGrid->addLayout(btnLayout, 4, 0, 1, 2);

    // Row 5: Status
    m_bridgeStatus = new QLabel("● Bridge: Not Connected");
    m_bridgeStatus->setStyleSheet("font-size: 11px; color: #ff6b6b; padding: 4px 0;");

    m_vmStatus = new QLabel("VM: Idle");
    m_vmStatus->setStyleSheet("font-size: 11px; color: #888; padding: 4px 0;");

    ctlGrid->addWidget(m_bridgeStatus, 5, 0, 1, 2);
    ctlGrid->addWidget(m_vmStatus, 6, 0, 1, 2);

    mainLayout->addWidget(controlPanel);

    // ── VNC Display ────────────────────────────────────────────────────────
    m_vncDisplay = new VNCWidget();
    m_vncDisplay->setMinimumHeight(480);
    m_vncDisplay->setStyleSheet("background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 8px;");

    mainLayout->addWidget(m_vncDisplay, 1);

    // ── Connections ────────────────────────────────────────────────────────
    connect(m_connectBtn, &QPushButton::clicked, this, &VMSandboxView::onConnectBridge);
    connect(m_disconnectBtn, &QPushButton::clicked, this, &VMSandboxView::onDisconnectBridge);
    connect(m_bootBtn, &QPushButton::clicked, this, &VMSandboxView::onBootVM);
    connect(m_stopBtn, &QPushButton::clicked, this, &VMSandboxView::onStopVM);
    connect(m_pauseBtn, &QPushButton::clicked, this, &VMSandboxView::onPauseVM);
    connect(m_downloadBtn, &QPushButton::clicked, this, &VMSandboxView::onDownloadISO);
    connect(m_osCombo, QOverload<int>::of(&QComboBox::currentIndexChanged), this, &VMSandboxView::onOSChanged);

    // Connect VNC display signals
    connect(m_vncDisplay, &VNCWidget::connected, this, [this]() {
        m_vmStatus->setText("VM: Running — VNC connected");
    });
    connect(m_vncDisplay, &VNCWidget::disconnected, this, [this]() {
        m_vmStatus->setText("VM: Stopped — VNC disconnected");
    });

    // Trigger initial OS info display
    onOSChanged(0);
}

void VMSandboxView::onOSChanged(int index)
{
    QString os = m_osCombo->itemData(index).toString();
    auto it = m_osConfigs.find(os);
    if (it != m_osConfigs.end()) {
        m_osInfo->setText(QString("▸ %1\n▸ Min RAM: %2 MB | Recommended: %3 MB | Min cores: %4")
                         .arg(it->description)
                         .arg(it->minRam)
                         .arg(it->recommendedRam)
                         .arg(it->minCores));

        // Update RAM/CU limits based on OS
        m_ramSlider->setMinimum(it->minRam);
        m_cpuSlider->setMinimum(it->minCores);

        if (m_ramSlider->value() < it->minRam)
            m_ramSlider->setValue(it->recommendedRam);
    }
    updateUIState();
}

void VMSandboxView::updateUIState()
{
    m_connectBtn->setVisible(!m_bridgeConnected);
    m_disconnectBtn->setVisible(m_bridgeConnected);
    m_bootBtn->setEnabled(m_bridgeConnected && !m_vmRunning);
    m_stopBtn->setVisible(m_vmRunning);
    m_pauseBtn->setVisible(m_vmRunning);
    m_osCombo->setEnabled(!m_vmRunning);
    m_ramSlider->setEnabled(!m_vmRunning);
    m_cpuSlider->setEnabled(!m_vmRunning);
}

void VMSandboxView::onConnectBridge()
{
    m_bridge->connectToBridge("ws://localhost:5900");
    m_bridgeStatus->setText("● Bridge: Connecting...");
    m_bridgeStatus->setStyleSheet("font-size: 11px; color: #ffd43b;");
}

void VMSandboxView::onDisconnectBridge()
{
    if (m_vmRunning) {
        m_bridge->stopVM(m_currentVmId);
    }
    m_bridge->disconnectFromBridge();
}

void VMSandboxView::onBootVM()
{
    if (!m_bridgeConnected) return;

    QString os = m_osCombo->currentData().toString();
    int ram = m_ramSlider->value();
    int cores = m_cpuSlider->value();

    m_bootBtn->setEnabled(false);
    m_bootBtn->setText("Booting...");
    m_vmStatus->setText("VM: Booting...");
    m_vmStatus->setStyleSheet("font-size: 11px; color: #ffd43b;");

    m_bridge->bootVM(os, ram, cores);
}

void VMSandboxView::onStopVM()
{
    if (!m_currentVmId.isEmpty() && m_bridgeConnected) {
        m_bridge->stopVM(m_currentVmId);
    }
    m_vmRunning = false;
    m_vmStatus->setText("VM: Stopped");
    m_vmStatus->setStyleSheet("font-size: 11px; color: #ff6b6b;");
    m_vncDisplay->disconnectFromHost();
    updateUIState();
}

void VMSandboxView::onPauseVM()
{
    m_vmPaused = !m_vmPaused;
    m_pauseBtn->setText(m_vmPaused ? "▶ Resume" : "⏸  Pause");
    m_vmStatus->setText(m_vmPaused ? "VM: Paused" : "VM: Running");
}

void VMSandboxView::onDownloadISO()
{
    QString os = m_osCombo->currentData().toString();

    // Map OS to download URLs
    QMap<QString, QString> isoUrls;
    isoUrls["ubuntu-24"] = "https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso";
    isoUrls["ubuntu-22"] = "https://releases.ubuntu.com/22.04/ubuntu-22.04.4-desktop-amd64.iso";
    isoUrls["fedora-40"] = "https://download.fedoraproject.org/pub/fedora/linux/releases/40/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-40-1.14.iso";
    isoUrls["debian-12"] = "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.5.0-amd64-netinst.iso";
    isoUrls["alpine"] = "https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/x86_64/alpine-virt-3.19.1-x86_64.iso";

    QString url = isoUrls.value(os);
    if (!url.isEmpty()) {
        QDesktopServices::openUrl(QUrl(url));
    } else {
        QMessageBox::information(this, "ISO Download",
            "This OS requires a licensed ISO. Please obtain it from the official source.");
    }
}

void VMSandboxView::onBridgeConnected()
{
    m_bridgeConnected = true;
    m_bridgeStatus->setText("● Bridge: Connected");
    m_bridgeStatus->setStyleSheet("font-size: 11px; color: #51cf66;");
    updateUIState();
}

void VMSandboxView::onBridgeDisconnected()
{
    m_bridgeConnected = false;
    m_bridgeStatus->setText("● Bridge: Not Connected");
    m_bridgeStatus->setStyleSheet("font-size: 11px; color: #ff6b6b;");
    if (m_vmRunning) {
        m_vmRunning = false;
        m_vncDisplay->disconnectFromHost();
    }
    updateUIState();
}

void VMSandboxView::onBridgeError(const QString &error)
{
    m_bridgeStatus->setText("● Bridge Error: " + error);
    m_bridgeStatus->setStyleSheet("font-size: 11px; color: #ff6b6b;");
}

void VMSandboxView::onVMBooted(const QString &vmId, int vncPort, bool hasIso)
{
    m_currentVmId = vmId;
    m_currentVncPort = vncPort;
    m_vmRunning = true;
    m_hasIso = hasIso;

    m_vmStatus->setText(QString("VM: Running — VNC on localhost:%1").arg(vncPort));
    m_vmStatus->setStyleSheet("font-size: 11px; color: #51cf66;");
    m_bootBtn->setText("▶  Boot VM");

    // Connect VNC display
    m_vncDisplay->connectToHost("127.0.0.1", vncPort);
    updateUIState();
}

void VMSandboxView::onVMStopped(const QString &vmId)
{
    Q_UNUSED(vmId);
    m_vmRunning = false;
    m_vmStatus->setText("VM: Stopped");
    m_vmStatus->setStyleSheet("font-size: 11px; color: #ff6b6b;");
    m_vncDisplay->disconnectFromHost();
    updateUIState();
}

void VMSandboxView::handleBridgeMessage(const QJsonObject &msg)
{
    // Route bridge messages to the VMBridgeManager for processing
    QString status = msg["status"].toString();
    QString action = msg["action"].toString();

    if (action == "boot" || status == "success") {
        // Already handled via VMBridgeManager signals
    }
}
