// Thalamus AI — OSSelectorDialog.cpp
#include "OSSelectorDialog.h"
#include <QVBoxLayout>
#include <QLabel>
#include <QFont>

OSSelectorDialog::OSSelectorDialog(QWidget *parent)
    : QDialog(parent)
{
    setupUi();
}

QString OSSelectorDialog::selectedOs() const { return m_selectedOs; }

void OSSelectorDialog::setupUi()
{
    setWindowTitle("Select Operating System");
    setFixedSize(360, 340);
    setModal(true);

    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(16);
    layout->setContentsMargins(20, 20, 20, 20);

    auto *header = new QLabel("Choose a VM OS");
    QFont font = header->font();
    font.setPointSize(16);
    font.setBold(true);
    header->setFont(font);
    header->setStyleSheet("color: #c0c0f0;");
    layout->addWidget(header);

    m_osList = new QListWidget;
    m_osList->setStyleSheet(
        "QListWidget { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "color: #e0e0f0; font-size: 14px; }"
        "QListWidget::item { padding: 10px 16px; border-bottom: 1px solid #1e1e32; }"
        "QListWidget::item:selected { background: #2a2a4a; color: #c0c0ff; }"
        "QListWidget::item:hover { background: #1e1e36; }");

    m_osList->addItems({
        "Windows 11 Pro",
        "Ubuntu 24.04 LTS",
        "Fedora 40",
        "macOS 15 Sequoia",
        "Android 14",
        "Debian 12"
    });
    m_osList->setCurrentRow(0);
    layout->addWidget(m_osList, 1);

    auto *buttonBox = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
    buttonBox->setStyleSheet(
        "QPushButton { padding: 8px 20px; border: none; border-radius: 6px; "
        "font-size: 13px; }"
        "QPushButton[text=\"OK\"] { "
        "background: #4a4aff; color: white; font-weight: bold; }"
        "QPushButton[text=\"Cancel\"] { "
        "background: #2e2e4e; color: #a0a0c0; }");
    connect(buttonBox, &QDialogButtonBox::accepted, this, [this]() {
        auto *item = m_osList->currentItem();
        if (item) {
            m_selectedOs = item->text();
            accept();
        }
    });
    connect(buttonBox, &QDialogButtonBox::rejected, this, &QDialog::reject);
    layout->addWidget(buttonBox);
}
