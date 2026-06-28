#include "OSSelectorDialog.h"
#include <QHBoxLayout>
#include <QFrame>
#include <QScrollArea>
#include <QJsonDocument>
#include <QJsonArray>

OSSelectorDialog::OSSelectorDialog(QWidget *parent)
    : QDialog(parent)
{
    setupUI();
}

OSSelectorDialog::~OSSelectorDialog() {}

void OSSelectorDialog::setupUI()
{
    setWindowTitle("Boot Virtual Machine");
    setFixedSize(600, 500);
    setStyleSheet("background: #0d0d0d; color: #e0e0e0;");

    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(20, 20, 20, 20);
    mainLayout->setSpacing(16);

    auto *header = new QLabel("🖥️  Select Operating System");
    header->setStyleSheet("font-size: 20px; font-weight: 700; color: #fff;");

    auto *subtitle = new QLabel("Choose an OS to boot in the QEMU virtual machine");
    subtitle->setStyleSheet("font-size: 12px; color: #888;");

    m_osList = new QListWidget();
    m_osList->setStyleSheet(
        "QListWidget { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 8px; }"
        "QListWidget::item { padding: 12px; border-radius: 6px; margin: 2px 0; }"
        "QListWidget::item:selected { background: #a78bfa22; color: #a78bfa; }"
        "QListWidget::item:hover { background: #2a2a2a; }"
    );

    // Populate OS list
    // Windows category
    auto *winCategory = new QListWidgetItem("──  Windows ──");
    winCategory->setFlags(Qt::NoItemFlags);
    winCategory->setForeground(QColor("#888"));

    auto addOS = [this](const QString &id, const QString &name, const QString &desc) {
        auto *item = new QListWidgetItem(name);
        item->setData(Qt::UserRole, id);
        item->setData(Qt::UserRole + 1, desc);
        m_osList->addItem(item);
    };

    addOS("windows-11", "🪟  Windows 11 Pro", "64-bit, TPM 2.0, Secure Boot, 8GB RAM recommended");
    addOS("windows-10", "🪟  Windows 10 Pro", "64-bit, UEFI, 4GB RAM recommended");
    addOS("ubuntu-24", "🐧  Ubuntu 24.04 LTS", "64-bit Linux, SPICE, 4GB RAM recommended");
    addOS("ubuntu-22", "🐧  Ubuntu 22.04 LTS", "64-bit Linux, 4GB RAM recommended");
    addOS("fedora-40", "🐧  Fedora 40 Workstation", "64-bit Linux, 4GB RAM recommended");
    addOS("debian-12", "🐧  Debian 12 Bookworm", "64-bit Linux, 2GB RAM recommended");
    addOS("macos-sequoia", "🍎  macOS 15 Sequoia", "Experimental, HVF acceleration, 8GB RAM");
    addOS("android-14", "🤖  Android 14 x86_64", "Android x86_64, 4GB RAM recommended");
    addOS("alpine", "🐧  Alpine Linux", "Lightweight 64-bit, 1GB RAM");
    addOS("freedos", "💾  FreeDOS", "16-bit legacy, 128MB RAM");

    m_osInfo = new QLabel();
    m_osInfo->setStyleSheet("font-size: 12px; color: #888; padding: 8px 12px; background: #1a1a1a; border-radius: 6px;");
    m_osInfo->setWordWrap(true);

    // Buttons
    auto *btnLayout = new QHBoxLayout();
    btnLayout->setSpacing(8);

    m_cancelBtn = new QPushButton("Cancel");
    m_cancelBtn->setCursor(Qt::PointingHandCursor);
    m_cancelBtn->setStyleSheet(
        "QPushButton { background: transparent; color: #888; border: 1px solid #333; border-radius: 8px;"
        "  padding: 10px 20px; font-size: 12px; }"
        "QPushButton:hover { color: #ccc; border-color: #555; }"
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

    btnLayout->addStretch();
    btnLayout->addWidget(m_cancelBtn);
    btnLayout->addWidget(m_bootBtn);

    mainLayout->addWidget(header);
    mainLayout->addWidget(subtitle);
    mainLayout->addWidget(m_osList, 1);
    mainLayout->addWidget(m_osInfo);
    mainLayout->addLayout(btnLayout);

    // Connections
    connect(m_osList, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *current, QListWidgetItem *) {
        if (!current || !(current->flags() & Qt::ItemIsSelectable)) {
            m_bootBtn->setEnabled(false);
            return;
        }
        m_selectedOS = current->data(Qt::UserRole).toString();
        m_selectedOSName = current->text();
        QString desc = current->data(Qt::UserRole + 1).toString();
        m_osInfo->setText("▸ " + desc);
        m_bootBtn->setEnabled(true);
    });

    connect(m_bootBtn, &QPushButton::clicked, this, &OSSelectorDialog::accept);
    connect(m_cancelBtn, &QPushButton::clicked, this, &QDialog::reject);
}

QString OSSelectorDialog::selectedOSName() const
{
    return m_selectedOSName;
}
