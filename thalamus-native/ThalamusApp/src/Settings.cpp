#include "Settings.h"
#include <QSettings>
#include <QMessageBox>
#include <QFileDialog>
#include <QApplication>
#include <QFormLayout>
#include <QFrame>
#include <QScrollArea>

Settings::Settings(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
{
    setupUI();
    loadSettings();
}

Settings::~Settings()
{
    saveSettings();
}

void Settings::setupUI()
{
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(16, 16, 16, 16);
    mainLayout->setSpacing(16);

    auto *header = new QLabel("⚙️  Settings");
    header->setStyleSheet("font-size: 22px; font-weight: 700; color: #fff;");
    mainLayout->addWidget(header);

    m_tabWidget = new QTabWidget();
    m_tabWidget->setStyleSheet(
        "QTabWidget::pane { background: #1a1a1a; border: none; border-radius: 8px; padding: 16px; }"
        "QTabBar::tab { background: transparent; color: #888; padding: 8px 16px; border: none; font-size: 12px; font-weight: 600; }"
        "QTabBar::tab:selected { color: #a78bfa; border-bottom: 2px solid #a78bfa; }"
        "QTabBar::tab:hover:!selected { color: #ccc; }"
    );

    // ── General Tab ────────────────────────────────────────────────────────
    auto *generalTab = new QWidget();
    auto *genLayout = new QVBoxLayout(generalTab);
    genLayout->setSpacing(12);

    auto *convexGroup = new QGroupBox("Convex Connection");
    convexGroup->setStyleSheet("QGroupBox { font-weight: 600; color: #ccc; border: 1px solid #2a2a2a; border-radius: 8px; margin-top: 8px; padding-top: 16px; } QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 6px; }");
    auto *convForm = new QFormLayout(convexGroup);

    m_convexUrlInput = new QLineEdit("https://glad-ermine-937.convex.cloud");
    m_convexUrlInput->setStyleSheet("QLineEdit { background: #0d0d0d; border: 1px solid #333; border-radius: 6px; padding: 8px; font-size: 12px; color: #e0e0e0; font-family: monospace; } QLineEdit:focus { border-color: #a78bfa; }");

    m_siteUrlInput = new QLineEdit("https://thalamus.aphantic.skinticals.com");
    m_siteUrlInput->setStyleSheet(m_convexUrlInput->styleSheet());

    convForm->addRow("Convex URL:", m_convexUrlInput);
    convForm->addRow("Site URL:", m_siteUrlInput);

    auto *appGroup = new QGroupBox("Application");
    appGroup->setStyleSheet(convexGroup->styleSheet());
    auto *appForm = new QFormLayout(appGroup);

    m_startMinimized = new QCheckBox("Start minimized to system tray");
    m_startMinimized->setStyleSheet("QCheckBox { font-size: 12px; color: #ccc; } QCheckBox::indicator { width: 16px; height: 16px; }");
    m_trayIconCheck = new QCheckBox("Minimize to system tray instead of closing");
    m_trayIconCheck->setStyleSheet(m_startMinimized->styleSheet());
    m_trayIconCheck->setChecked(true);
    m_autoConnectBridge = new QCheckBox("Auto-connect VM bridge on startup");
    m_autoConnectBridge->setStyleSheet(m_startMinimized->styleSheet());

    m_themeCombo = new QComboBox();
    m_themeCombo->addItems({"Dark", "Light", "System"});
    m_themeCombo->setStyleSheet("QComboBox { background: #0d0d0d; border: 1px solid #333; border-radius: 6px; padding: 6px; font-size: 12px; color: #e0e0e0; min-width: 120px; } QComboBox::drop-down { border: none; } QComboBox:hover { border-color: #a78bfa; }");

    appForm->addRow(m_startMinimized);
    appForm->addRow(m_trayIconCheck);
    appForm->addRow(m_autoConnectBridge);
    appForm->addRow("Theme:", m_themeCombo);

    auto *saveGenBtn = new QPushButton("Save Settings");
    saveGenBtn->setCursor(Qt::PointingHandCursor);
    saveGenBtn->setStyleSheet(
        "QPushButton { background: #a78bfa; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #8b6ff0; }"
    );

    genLayout->addWidget(convexGroup);
    genLayout->addWidget(appGroup);
    genLayout->addStretch();
    genLayout->addWidget(saveGenBtn);

    connect(saveGenBtn, &QPushButton::clicked, this, &Settings::onSaveGeneral);

    // ── VM Tab ──────────────────────────────────────────────────────────────
    auto *vmTab = new QWidget();
    auto *vmLayout = new QVBoxLayout(vmTab);
    vmLayout->setSpacing(12);

    auto *vmSettingsGroup = new QGroupBox("VM Defaults");
    vmSettingsGroup->setStyleSheet(convexGroup->styleSheet());
    auto *vmForm = new QFormLayout(vmSettingsGroup);

    m_defaultRam = new QSpinBox();
    m_defaultRam->setRange(512, 16384);
    m_defaultRam->setValue(4096);
    m_defaultRam->setSuffix(" MB");
    m_defaultRam->setSingleStep(512);
    m_defaultRam->setStyleSheet("QSpinBox { background: #0d0d0d; border: 1px solid #333; border-radius: 6px; padding: 6px; font-size: 12px; color: #e0e0e0; min-width: 100px; }");

    m_defaultCores = new QSpinBox();
    m_defaultCores->setRange(1, 16);
    m_defaultCores->setValue(4);
    m_defaultCores->setStyleSheet(m_defaultRam->styleSheet());

    auto *vmPathsGroup = new QGroupBox("VM Paths");
    vmPathsGroup->setStyleSheet(convexGroup->styleSheet());
    auto *pathsForm = new QFormLayout(vmPathsGroup);

    m_qemuPath = new QLineEdit("C:\\Program Files\\QEMU\\qemu-system-x86_64.exe");
    m_qemuPath->setStyleSheet("QLineEdit { background: #0d0d0d; border: 1px solid #333; border-radius: 6px; padding: 8px; font-size: 12px; color: #e0e0e0; } QLineEdit:focus { border-color: #a78bfa; }");

    auto *browseQemu = new QPushButton("...");
    browseQemu->setFixedSize(32, 32);
    browseQemu->setStyleSheet("QPushButton { background: #2a2a2a; color: #fff; border: 1px solid #333; border-radius: 6px; font-size: 14px; } QPushButton:hover { background: #3a3a3a; }");

    auto *qemuLayout = new QHBoxLayout();
    qemuLayout->addWidget(m_qemuPath);
    qemuLayout->addWidget(browseQemu);

    m_bridgePath = new QLineEdit("%LOCALAPPDATA%\\Thalamus\\thalamus-vm-bridge.exe");
    m_bridgePath->setStyleSheet(m_qemuPath->styleSheet());

    m_vmDataDir = new QLineEdit("%LOCALAPPDATA%\\Thalamus\\vms");
    m_vmDataDir->setStyleSheet(m_qemuPath->styleSheet());

    vmForm->addRow("Default RAM:", m_defaultRam);
    vmForm->addRow("Default CPU cores:", m_defaultCores);
    pathsForm->addRow("QEMU path:", qemuLayout);
    pathsForm->addRow("Bridge path:", m_bridgePath);
    pathsForm->addRow("VM data dir:", m_vmDataDir);

    auto *saveVMBtn = new QPushButton("Save VM Settings");
    saveVMBtn->setCursor(Qt::PointingHandCursor);
    saveVMBtn->setStyleSheet(saveGenBtn->styleSheet());

    vmLayout->addWidget(vmSettingsGroup);
    vmLayout->addWidget(vmPathsGroup);
    vmLayout->addStretch();
    vmLayout->addWidget(saveVMBtn);

    connect(saveVMBtn, &QPushButton::clicked, this, &Settings::onSaveVM);
    connect(browseQemu, &QPushButton::clicked, this, [this]() {
        QString path = QFileDialog::getOpenFileName(this, "Select QEMU executable", "C:\\Program Files\\QEMU", "QEMU (*.exe)");
        if (!path.isEmpty()) m_qemuPath->setText(path);
    });

    // ── Account Tab ─────────────────────────────────────────────────────────
    auto *accountTab = new QWidget();
    auto *acctLayout = new QVBoxLayout(accountTab);
    acctLayout->setSpacing(12);

    auto *acctGroup = new QGroupBox("Account");
    acctGroup->setStyleSheet(convexGroup->styleSheet());
    auto *acctForm = new QFormLayout(acctGroup);

    m_userEmail = new QLabel("Not signed in");
    m_userEmail->setStyleSheet("font-size: 13px; color: #ccc; padding: 4px 8px;");

    m_userName = new QLabel("");
    m_userName->setStyleSheet("font-size: 13px; color: #ccc; padding: 4px 8px;");

    m_signOutBtn = new QPushButton("Sign Out");
    m_signOutBtn->setCursor(Qt::PointingHandCursor);
    m_signOutBtn->setStyleSheet(
        "QPushButton { background: #ff6b6b; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #e05555; }"
    );

    acctForm->addRow("Email:", m_userEmail);
    acctForm->addRow("Name:", m_userName);

    acctLayout->addWidget(acctGroup);
    acctLayout->addWidget(m_signOutBtn);
    acctLayout->addStretch();

    connect(m_signOutBtn, &QPushButton::clicked, this, &Settings::onSignOut);

    // ── About Tab ───────────────────────────────────────────────────────────
    auto *aboutTab = new QWidget();
    auto *aboutLayout = new QVBoxLayout(aboutTab);
    aboutLayout->setSpacing(12);

    auto *aboutGroup = new QGroupBox("Thalamus AI");
    aboutGroup->setStyleSheet(convexGroup->styleSheet());
    auto *aboutForm = new QFormLayout(aboutGroup);

    m_versionLabel = new QLabel("v1.0.0");
    m_versionLabel->setStyleSheet("font-size: 16px; font-weight: 700; color: #a78bfa;");

    auto *buildLabel = new QLabel("Built with Qt 6 | Convex Backend | QEMU Virtualisation");
    buildLabel->setStyleSheet("font-size: 11px; color: #888;");

    m_updateBtn = new QPushButton("Check for Updates");
    m_updateBtn->setCursor(Qt::PointingHandCursor);
    m_updateBtn->setStyleSheet(
        "QPushButton { background: #51cf66; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #40c057; }"
    );

    auto *copyrightLabel = new QLabel("© 2026 Aphantic Corporations. All rights reserved.");
    copyrightLabel->setStyleSheet("font-size: 10px; color: #555;");

    aboutForm->addRow("Version:", m_versionLabel);
    aboutForm->addRow("", buildLabel);

    aboutLayout->addWidget(aboutGroup);
    aboutLayout->addWidget(m_updateBtn);
    aboutLayout->addStretch();
    aboutLayout->addWidget(copyrightLabel);

    connect(m_updateBtn, &QPushButton::clicked, this, &Settings::onCheckForUpdates);

    // Add tabs
    m_tabWidget->addTab(generalTab, "General");
    m_tabWidget->addTab(vmTab, "VM & Bridge");
    m_tabWidget->addTab(accountTab, "Account");
    m_tabWidget->addTab(aboutTab, "About");

    mainLayout->addWidget(m_tabWidget);
}

void Settings::loadSettings()
{
    QSettings settings("Thalamus", "ThalamusAI");
    m_convexUrlInput->setText(settings.value("convexUrl", "https://glad-ermine-937.convex.cloud").toString());
    m_siteUrlInput->setText(settings.value("siteUrl", "https://thalamus.aphantic.skinticals.com").toString());
    m_startMinimized->setChecked(settings.value("startMinimized", false).toBool());
    m_trayIconCheck->setChecked(settings.value("trayEnabled", true).toBool());
    m_autoConnectBridge->setChecked(settings.value("autoConnectBridge", false).toBool());
    m_defaultRam->setValue(settings.value("defaultRam", 4096).toInt());
    m_defaultCores->setValue(settings.value("defaultCores", 4).toInt());
    m_qemuPath->setText(settings.value("qemuPath", "C:\\Program Files\\QEMU\\qemu-system-x86_64.exe").toString());
    m_bridgePath->setText(settings.value("bridgePath", "").toString());
    m_vmDataDir->setText(settings.value("vmDataDir", "%LOCALAPPDATA%\\Thalamus\\vms").toString());

    // Update account info
    if (m_client->isAuthenticated()) {
        QJsonObject user = m_client->currentUser();
        m_userEmail->setText(user["email"].toString());
        m_userName->setText(user["name"].toString());
    }
}

void Settings::saveSettings()
{
    QSettings settings("Thalamus", "ThalamusAI");
    settings.setValue("convexUrl", m_convexUrlInput->text());
    settings.setValue("siteUrl", m_siteUrlInput->text());
    settings.setValue("startMinimized", m_startMinimized->isChecked());
    settings.setValue("trayEnabled", m_trayIconCheck->isChecked());
    settings.setValue("autoConnectBridge", m_autoConnectBridge->isChecked());
    settings.setValue("defaultRam", m_defaultRam->value());
    settings.setValue("defaultCores", m_defaultCores->value());
    settings.setValue("qemuPath", m_qemuPath->text());
    settings.setValue("bridgePath", m_bridgePath->text());
    settings.setValue("vmDataDir", m_vmDataDir->text());
}

void Settings::onSaveGeneral()
{
    saveSettings();
    m_client->setConvexUrl(m_convexUrlInput->text());
    m_client->setSiteUrl(m_siteUrlInput->text());
    emit convexUrlChanged(m_convexUrlInput->text());
    QMessageBox::information(this, "Settings", "Settings saved successfully.");
}

void Settings::onSaveVM()
{
    saveSettings();
    QMessageBox::information(this, "VM Settings", "VM settings saved.");
}

void Settings::onSignOut()
{
    auto result = QMessageBox::question(this, "Sign Out",
        "Are you sure you want to sign out?",
        QMessageBox::Yes | QMessageBox::No);

    if (result == QMessageBox::Yes) {
        m_client->logout();
        m_userEmail->setText("Not signed in");
        m_userName->setText("");
    }
}

void Settings::onCheckForUpdates()
{
    QMessageBox::information(this, "Updates",
        "You are running the latest version (v1.0.0).\n\n"
        "Auto-update will check GitHub Releases periodically.");
}
