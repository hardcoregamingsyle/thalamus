#include "FileTreeWidget.h"
#include <QApplication>
#include <QStyle>
#include <QHeaderView>
#include <QVBoxLayout>

FileTreeWidget::FileTreeWidget(QWidget *parent)
    : QWidget(parent)
{
    setupUI();
}

FileTreeWidget::~FileTreeWidget() {}

void FileTreeWidget::setupUI()
{
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(4);

    m_header = new QLabel("📁  Files");
    m_header->setStyleSheet("font-size: 11px; font-weight: 600; color: #888; padding: 4px 8px;");

    m_tree = new QTreeWidget();
    m_tree->setHeaderHidden(true);
    m_tree->setAnimated(true);
    m_tree->setIndentation(16);
    m_tree->setStyleSheet(
        "QTreeWidget { background: transparent; border: none; font-size: 11px; }"
        "QTreeWidget::item { padding: 4px 6px; border-radius: 3px; min-height: 22px; }"
        "QTreeWidget::item:selected { background: #a78bfa22; color: #a78bfa; }"
        "QTreeWidget::item:hover { background: #1a1a1a; }"
        "QTreeWidget::branch:has-children:!has-siblings:closed, "
        "QTreeWidget::branch:closed:has-children:has-siblings { "
        "  border-image: none; image: none; }"
        "QTreeWidget::branch:open:has-children:!has-siblings, "
        "QTreeWidget::branch:open:has-children:has-siblings { "
        "  border-image: none; image: none; }"
    );

    connect(m_tree, &QTreeWidget::itemClicked, this, [this](QTreeWidgetItem *item, int) {
        if (item && !item->childCount()) { // Only files (leaf nodes)
            emit fileSelected(item->data(0, Qt::UserRole).toString());
        }
    });

    connect(m_tree, &QTreeWidget::itemDoubleClicked, this, [this](QTreeWidgetItem *item, int) {
        if (item && !item->childCount()) {
            emit fileDoubleClicked(item->data(0, Qt::UserRole).toString());
        }
    });

    layout->addWidget(m_header);
    layout->addWidget(m_tree);
}

QString FileTreeWidget::getFileIcon(const QString &fileName)
{
    if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) return "🔵";
    if (fileName.endsWith(".js") || fileName.endsWith(".jsx")) return "🟡";
    if (fileName.endsWith(".py")) return "🐍";
    if (fileName.endsWith(".css") || fileName.endsWith(".scss")) return "🎨";
    if (fileName.endsWith(".html") || fileName.endsWith(".htm")) return "🌐";
    if (fileName.endsWith(".json")) return "📋";
    if (fileName.endsWith(".md")) return "📝";
    if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) return "⚙️";
    if (fileName.endsWith(".exe") || fileName.endsWith(".dll")) return "⚡";
    if (fileName == "Dockerfile" || fileName.endsWith("Dockerfile")) return "🐳";
    if (fileName.endsWith(".gitignore")) return "🙈";
    if (fileName.endsWith(".ico") || fileName.endsWith(".png") || fileName.endsWith(".jpg")) return "🖼️";
    if (fileName.endsWith(".c") || fileName.endsWith(".cpp") || fileName.endsWith(".h")) return "⚡";
    if (fileName.endsWith(".rs")) return "🦀";
    if (fileName.endsWith(".go")) return "🔷";
    if (fileName.endsWith(".sh") || fileName.endsWith(".bat")) return "📜";
    return "📄";
}

QString FileTreeWidget::getFileType(const QString &fileName)
{
    int dot = fileName.lastIndexOf('.');
    if (dot >= 0) return fileName.mid(dot + 1).toLower();
    return "unknown";
}

void FileTreeWidget::setFiles(const QJsonArray &files)
{
    m_tree->clear();
    for (const QJsonValue &val : files) {
        addFileToTree(nullptr, val.toString());
    }
}

void FileTreeWidget::setFileObjects(const QJsonArray &files)
{
    m_tree->clear();
    for (const QJsonValue &val : files) {
        QJsonObject fileObj = val.toObject();
        QString path = fileObj["filepath"].toString();
        if (path.isEmpty()) path = fileObj["path"].toString();
        if (path.isEmpty()) continue;

        QTreeWidgetItem *root = nullptr;
        for (int i = 0; i < m_tree->topLevelItemCount(); i++) {
            if (m_tree->topLevelItem(i)->data(0, Qt::UserRole).toString() == path) {
                root = m_tree->topLevelItem(i);
                break;
            }
        }

        QString icon = getFileIcon(path);
        auto *item = new QTreeWidgetItem();
        item->setText(0, icon + "  " + path.section('/', -1));
        item->setData(0, Qt::UserRole, path);
        item->setToolTip(0, path);
        m_tree->addTopLevelItem(item);
    }
}

void FileTreeWidget::clearFiles()
{
    m_tree->clear();
}

void FileTreeWidget::addFileToTree(QTreeWidgetItem *root, const QString &path)
{
    QString icon = getFileIcon(path);
    auto *item = new QTreeWidgetItem();
    item->setText(0, icon + "  " + path.section('/', -1));
    item->setData(0, Qt::UserRole, path);
    item->setToolTip(0, path);

    if (root) {
        root->addChild(item);
    } else {
        m_tree->addTopLevelItem(item);
    }
}

QString FileTreeWidget::selectedFilePath() const
{
    auto items = m_tree->selectedItems();
    if (items.isEmpty()) return "";
    return items.first()->data(0, Qt::UserRole).toString();
}

void FileTreeWidget::expandAll()
{
    m_tree->expandAll();
}

void FileTreeWidget::collapseAll()
{
    m_tree->collapseAll();
}
