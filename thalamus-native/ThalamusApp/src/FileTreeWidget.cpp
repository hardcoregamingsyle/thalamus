// Thalamus AI — FileTreeWidget.cpp
#include "FileTreeWidget.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QJsonArray>
#include <QJsonObject>
#include <QFileInfo>
#include <QMenu>

FileTreeWidget::FileTreeWidget(QWidget *parent)
    : QWidget(parent)
{
    setupUi();
}

void FileTreeWidget::setupUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(4);
    layout->setContentsMargins(0, 0, 0, 0);

    // Project header
    m_projectLabel = new QLabel("Project Files");
    m_projectLabel->setStyleSheet(
        "color: #a0a0c0; font-size: 12px; font-weight: bold; padding: 4px 0;");
    layout->addWidget(m_projectLabel);

    // Action buttons
    auto *buttonLayout = new QHBoxLayout;
    buttonLayout->setSpacing(4);

    m_newFileButton = new QPushButton("+ File");
    m_newFileButton->setCursor(Qt::PointingHandCursor);
    m_newFileButton->setStyleSheet(
        "QPushButton { padding: 4px 10px; border: 1px solid #3e3e5e; border-radius: 4px; "
        "background: transparent; color: #8080a0; font-size: 11px; }"
        "QPushButton:hover { border-color: #6e6eff; color: #c0c0f0; }");
    connect(m_newFileButton, &QPushButton::clicked, this, &FileTreeWidget::newFileRequested);
    buttonLayout->addWidget(m_newFileButton);

    m_newFolderButton = new QPushButton("+ Folder");
    m_newFolderButton->setCursor(Qt::PointingHandCursor);
    m_newFolderButton->setStyleSheet(m_newFileButton->styleSheet());
    connect(m_newFolderButton, &QPushButton::clicked, this, &FileTreeWidget::newFolderRequested);
    buttonLayout->addWidget(m_newFolderButton);

    buttonLayout->addStretch();
    layout->addLayout(buttonLayout);

    // Tree widget
    m_treeWidget = new QTreeWidget;
    m_treeWidget->setHeaderHidden(true);
    m_treeWidget->setAnimated(true);
    m_treeWidget->setIndentation(16);
    m_treeWidget->setStyleSheet(
        "QTreeWidget { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "color: #c0c0e0; font-size: 12px; }"
        "QTreeWidget::item { padding: 4px 8px; }"
        "QTreeWidget::item:selected { background: #2a2a4a; color: #c0c0ff; }"
        "QTreeWidget::item:hover { background: #1e1e36; }");

    connect(m_treeWidget, &QTreeWidget::itemDoubleClicked,
            this, [this](QTreeWidgetItem *item, int) {
        if (item && !item->childCount()) {
            emit fileSelected(item->data(0, Qt::UserRole).toString());
        }
    });

    // Context menu
    m_treeWidget->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(m_treeWidget, &QTreeWidget::customContextMenuRequested,
            this, [this](const QPoint &pos) {
        QTreeWidgetItem *item = m_treeWidget->itemAt(pos);
        if (item) {
            QMenu menu(this);
            menu.setStyleSheet(
                "QMenu { background: #1e1e32; border: 1px solid #2e2e4e; color: #c0c0e0; }"
                "QMenu::item:selected { background: #2a2a4a; }");

            QAction *openAction = menu.addAction("Open");
            connect(openAction, &QAction::triggered, this, [this, item]() {
                emit fileSelected(item->data(0, Qt::UserRole).toString());
            });

            if (!item->childCount()) {
                QAction *deleteAction = menu.addAction("Delete");
                connect(deleteAction, &QAction::triggered, this, [this, item]() {
                    emit fileDeleted(item->data(0, Qt::UserRole).toString());
                });
            }

            menu.exec(m_treeWidget->viewport()->mapToGlobal(pos));
        }
    });

    layout->addWidget(m_treeWidget, 1);
}

void FileTreeWidget::loadFiles(const QJsonArray &files)
{
    m_treeWidget->clear();
    populateTree(files, nullptr);
}

void FileTreeWidget::populateTree(const QJsonArray &files, QTreeWidgetItem *parentItem)
{
    for (const QJsonValue &val : files) {
        QJsonObject file = val.toObject();
        QString name = file["name"].toString();
        QString path = file["path"].toString();
        bool isDir = file["type"].toString() == "directory";

        auto *item = parentItem
            ? new QTreeWidgetItem(parentItem)
            : new QTreeWidgetItem(m_treeWidget);

        item->setText(0, name);
        item->setData(0, Qt::UserRole, path);

        if (isDir) {
            item->setChildIndicatorPolicy(QTreeWidgetItem::ShowIndicator);
            QJsonArray children = file["children"].toArray();
            populateTree(children, item);
        }

        // Set icon based on extension
        QString ext = QFileInfo(name).suffix().toLower();
        if (ext == "cpp" || ext == "h" || ext == "hpp")
            item->setForeground(0, QColor("#6e9eff"));
        else if (ext == "js" || ext == "ts" || ext == "jsx" || ext == "tsx")
            item->setForeground(0, QColor("#f0db4f"));
        else if (ext == "py")
            item->setForeground(0, QColor("#3572A5"));
        else if (ext == "json" || ext == "yaml" || ext == "yml")
            item->setForeground(0, QColor("#5a5a7a"));
    }
}

void FileTreeWidget::clear()
{
    m_treeWidget->clear();
}
