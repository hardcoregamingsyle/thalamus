// Thalamus AI — Settings.cpp
#include "Settings.h"
#include "ConvexClient.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFormLayout>
#include <QGroupBox>
#include <QSettings>
#include <QMessageBox>

Settings::Settings(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
{
    setupUi();
    loadSettings();

    connect(m_client, &ConvexClient::authStateChanged, this, [this](bool authenticated) {
        m_authStatusLabel->setText(authenticated ? "Signed in" : "Not signed in");
        m_signOutButton->setEnabled(authenticated);
    });
}

void Settings::setupUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(8);
    layout->setContentsMargins(16, 16, 16, 16);

    auto *header = new QLabel("Settings");
    header->setStyleSheet("font-size: 18px; font-weight: bold; color: #c0c0f0;");
    layout->addWidget(header);

    m_tabWidget = new QTabWidget(this);
    m_tabWidget->setStyleSheet(
        "QTabWidget::pane { border: 1px solid #2e2e4e; border-radius: 6px; "
        "background: #16162a; padding: 16px; }"
        "QTabBar::tab { padding: 8px 16px; color: #8080a0; font-size: 13px; }"
        "QTabBar::tab:selected { color: #c0c0f0; border-bottom: 2px solid #4a4aff; }");

    // ── General Tab ─────────────────────────────────────────────────────────
    auto *generalTab = new QWidget;
    auto *generalLayout = new QVBoxLayout(generalTab);
    generalLayout->setSpacing(12);

    auto *convexGroup = new QGroupBox("Convex Backend");
    convexGroup->setStyleSheet(
        "QGroupBox { color: #a0a0c0; border: 1px solid #2e2e4e; border-radius: 6px; "
        "padding: 12px; padding-top: 20px; font-size: 13px; }"
        "QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 4px; }");
    auto *convexForm = new QFormLayout(convexGroup);

    m_convexUrlInput = new QLineEdit;
    m_convexUrlInput->setStyleSheet(
        "QLineEdit { padding: 8px; border: 1px solid #3e3e5e; border-radius: 6px; "
        "background: #1e1e32; color: #e0e0f0; }");
    convexForm->addRow("API URL:", m_convexUrlInput);

    auto *saveButton = new QPushButton("Save");
    saveButton->setStyleSheet(
        "QPushButton { padding: 8px 16px; border: none; border-radius: 6px; "
        "background: #4a4aff; color: white; font-weight: bold; }"
        "QPushButton:hover { background: #5a5aff; }");
    connect(saveButton, &QPushButton::clicked, this, &Settings::onSaveGeneral);
    convexForm->addRow("", saveButton);

    generalLayout->addWidget(convexGroup);

    auto *authGroup = new QGroupBox("Authentication");
    authGroup->setStyleSheet(convexGroup->styleSheet());
    auto *authForm = new QFormLayout(authGroup);

    m_authStatusLabel = new QLabel("Not signed in");
    m_authStatusLabel->setStyleSheet("color: #8080a0;");
    authForm->addRow("Status:", m_authStatusLabel);

    m_signOutButton = new QPushButton("Sign Out");
    m_signOutButton->setStyleSheet(
        "QPushButton { padding: 8px 16px; border: 1px solid #ff4a4a; border-radius: 6px; "
        "color: #ff4a4a; background: transparent; }"
        "QPushButton:hover { background: #2a1a1a; }");
    m_signOutButton->setEnabled(false);
    connect(m_signOutButton, &QPushButton::clicked, this, &Settings::onSignOut);
    authForm->addRow("", m_signOutButton);

    generalLayout->addWidget(authGroup);
    generalLayout->addStretch();
    m_tabWidget->addTab(generalTab, "General");

    // ── VM Tab ──────────────────────────────────────────────────────────────
    auto *vmTab = new QWidget;
    auto *vmLayout = new QVBoxLayout(vmTab);
    vmLayout->setSpacing(12);

    auto *vmGroup = new QGroupBox("VM Configuration");
    vmGroup->setStyleSheet(convexGroup->styleSheet());
    auto *vmForm = new QFormLayout(vmGroup);

    m_vncPortSpinBox = new QSpinBox;
    m_vncPortSpinBox->setRange(5900, 5999);
    m_vncPortSpinBox->setValue(5900);
    m_vncPortSpinBox->setStyleSheet(m_convexUrlInput->styleSheet());
    vmForm->addRow("VNC Port:", m_vncPortSpinBox);

    m_qemuPathInput = new QLineEdit("qemu-system-x86_64");
    m_qemuPathInput->setStyleSheet(m_convexUrlInput->styleSheet());
    vmForm->addRow("QEMU Path:", m_qemuPathInput);

    m_defaultRamSpinBox = new QSpinBox;
    m_defaultRamSpinBox->setRange(1024, 32768);
    m_defaultRamSpinBox->setValue(4096);
    m_defaultRamSpinBox->setSuffix(" MB");
    m_defaultRamSpinBox->setSingleStep(1024);
    m_defaultRamSpinBox->setStyleSheet(m_convexUrlInput->styleSheet());
    vmForm->addRow("Default RAM:", m_defaultRamSpinBox);

    m_defaultCpuSpinBox = new QSpinBox;
    m_defaultCpuSpinBox->setRange(1, 16);
    m_defaultCpuSpinBox->setValue(4);
    m_defaultCpuSpinBox->setStyleSheet(m_convexUrlInput->styleSheet());
    vmForm->addRow("Default CPUs:", m_defaultCpuSpinBox);

    auto *saveVmButton = new QPushButton("Save");
    saveVmButton->setStyleSheet(saveButton->styleSheet());
    connect(saveVmButton, &QPushButton::clicked, this, &Settings::onSaveVm);
    vmForm->addRow("", saveVmButton);

    vmLayout->addWidget(vmGroup);
    vmLayout->addStretch();
    m_tabWidget->addTab(vmTab, "VM");

    // ── Updates Tab ─────────────────────────────────────────────────────────
    auto *updatesTab = new QWidget;
    auto *updatesLayout = new QVBoxLayout(updatesTab);
    updatesLayout->setSpacing(12);

    auto *updatesGroup = new QGroupBox("Application Updates");
    updatesGroup->setStyleSheet(convexGroup->styleSheet());
    auto *updatesForm = new QFormLayout(updatesGroup);

    m_versionLabel = new QLabel("1.0.0");
    m_versionLabel->setStyleSheet("color: #e0e0f0; font-size: 16px; font-weight: bold;");
    updatesForm->addRow("Current Version:", m_versionLabel);

    m_checkUpdatesButton = new QPushButton("Check for Updates");
    m_checkUpdatesButton->setStyleSheet(saveButton->styleSheet());
    connect(m_checkUpdatesButton, &QPushButton::clicked, this, &Settings::onCheckForUpdates);
    updatesForm->addRow("", m_checkUpdatesButton);

    updatesLayout->addWidget(updatesGroup);
    updatesLayout->addStretch();
    m_tabWidget->addTab(updatesTab, "Updates");

    layout->addWidget(m_tabWidget, 1);
}

void Settings::loadSettings()
{
    QSettings settings;
    m_convexUrlInput->setText(
        settings.value("convex/baseUrl", "https://glad-ermine-937.convex.cloud").toString());
    m_vncPortSpinBox->setValue(settings.value("vm/vncPort", 5900).toInt());
    m_qemuPathInput->setText(
        settings.value("vm/qemuPath", "qemu-system-x86_64").toString());
    m_defaultRamSpinBox->setValue(settings.value("vm/defaultRam", 4096).toInt());
    m_defaultCpuSpinBox->setValue(settings.value("vm/defaultCpu", 4).toInt());
    m_authStatusLabel->setText(m_client->isAuthenticated() ? "Signed in" : "Not signed in");
    m_signOutButton->setEnabled(m_client->isAuthenticated());
}

void Settings::onSaveGeneral()
{
    QSettings settings;
    settings.setValue("convex/baseUrl", m_convexUrlInput->text().trimmed());
    m_client->setBaseUrl(m_convexUrlInput->text().trimmed());
    QMessageBox::information(this, "Settings", "Convex backend URL updated.");
    emit settingsChanged();
}

void Settings::onSaveVm()
{
    QSettings settings;
    settings.setValue("vm/vncPort", m_vncPortSpinBox->value());
    settings.setValue("vm/qemuPath", m_qemuPathInput->text().trimmed());
    settings.setValue("vm/defaultRam", m_defaultRamSpinBox->value());
    settings.setValue("vm/defaultCpu", m_defaultCpuSpinBox->value());
    QMessageBox::information(this, "Settings", "VM configuration saved.");
    emit settingsChanged();
}

void Settings::onCheckForUpdates()
{
    m_checkUpdatesButton->setEnabled(false);
    m_checkUpdatesButton->setText("Checking...");
    QMessageBox::information(this, "Updates",
        "Update checking will be available via the AutoUpdater module.\n\n"
        "Current version: 1.0.0");
    m_checkUpdatesButton->setEnabled(true);
    m_checkUpdatesButton->setText("Check for Updates");
}

void Settings::onSignOut()
{
    m_client->signOut();
    QSettings settings;
    settings.remove("auth/token");
    QMessageBox::information(this, "Signed Out", "You have been signed out.");
    emit settingsChanged();
}
