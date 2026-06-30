// Thalamus AI — FileTreeWidget.h
#pragma once

#include <QWidget>
#include <QTreeWidget>
#include <QPushButton>
#include <QLabel>

class FileTreeWidget : public QWidget
{
    Q_OBJECT

public:
    explicit FileTreeWidget(QWidget *parent = nullptr);
    ~FileTreeWidget() = default;

    void loadFiles(const QJsonArray &files);
    void clear();

signals:
    void fileSelected(const QString &path);
    void fileDeleted(const QString &path);
    void newFileRequested();
    void newFolderRequested();

private:
    void setupUi();
    void populateTree(const QJsonArray &files, QTreeWidgetItem *parentItem);

    QTreeWidget *m_treeWidget;
    QLabel *m_projectLabel;
    QPushButton *m_newFileButton;
    QPushButton *m_newFolderButton;
};
