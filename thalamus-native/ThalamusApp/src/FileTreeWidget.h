#ifndef FILETREEWIDGET_H
#define FILETREEWIDGET_H

#include <QWidget>
#include <QTreeWidget>
#include <QVBoxLayout>
#include <QLabel>
#include <QJsonArray>
#include <QJsonObject>
#include <QMap>

/**
 * @brief File tree widget for browsing project files in Code mode.
 *
 * Displays a hierarchical file tree with syntax-highlighted file icons,
 * file size info, and drag-drop support.
 */
class FileTreeWidget : public QWidget
{
    Q_OBJECT

public:
    explicit FileTreeWidget(QWidget *parent = nullptr);
    ~FileTreeWidget();

    /// Update the file tree with a list of file paths
    void setFiles(const QJsonArray &files);

    /// Update with file objects containing path, size, type
    void setFileObjects(const QJsonArray &files);

    /// Clear the tree
    void clearFiles();

    /// Get selected file path
    QString selectedFilePath() const;

    /// Expand all directories
    void expandAll();

    /// Collapse all directories
    void collapseAll();

signals:
    void fileSelected(const QString &filePath);
    void fileDoubleClicked(const QString &filePath);

private:
    void setupUI();
    void addFileToTree(QTreeWidgetItem *root, const QString &path);
    QString getFileIcon(const QString &fileName);
    QString getFileType(const QString &fileName);

    QTreeWidget *m_tree;
    QLabel *m_header;

    // Cache for file types
    QMap<QString, QString> m_fileIcons;
};

#endif // FILETREEWIDGET_H
