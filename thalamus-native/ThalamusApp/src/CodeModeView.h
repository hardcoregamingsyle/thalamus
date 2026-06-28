#ifndef CODEMODEVIEW_H
#define CODEMODEVIEW_H

#include <QWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QLabel>
#include <QJsonArray>
#include <QJsonObject>
#include <QTreeWidget>
#include <QListWidget>
#include <QSplitter>
#include <QProcess>
#include "ConvexClient.h"
#include "MarkdownRenderer.h"

/**
 * @brief Code mode — 9-agent autonomous software development pipeline.
 *
 * Features:
 * - Project/branch management
 * - 9-agent pipeline (Researcher → Analyser → Planner → Coder → ...)
 * - File tree viewer
 * - Agent message log
 * - Deploy integration
 */
class CodeModeView : public QWidget
{
    Q_OBJECT

public:
    explicit CodeModeView(ConvexClient *client, QWidget *parent = nullptr);
    ~CodeModeView();

private slots:
    void onNewProject();
    void onCreateBranch();
    void onSelectProject();
    void onSendPrompt();
    void onAgentMessage(const QJsonObject &msg);

private:
    void setupUI();
    void appendAgentMessage(const QString &agent, const QString &content);
    void loadProjects();
    void loadBranches(const QString &projectId);
    void updateFileTree(const QJsonArray &files);
    void addLogEntry(const QString &level, const QString &message);

    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;

    // UI
    QWidget *m_sidebar;
    QTreeWidget *m_projectTree;
    QPushButton *m_newProjectBtn;
    QPushButton *m_newBranchBtn;

    QWidget *m_workspace;
    QScrollArea *m_logScroll;
    QWidget *m_logContainer;
    QVBoxLayout *m_logLayout;
    QTextEdit *m_promptInput;
    QPushButton *m_sendBtn;
    QLabel *m_projectLabel;
    QLabel *m_branchLabel;
    QLabel *m_statusLabel;

    // File tree
    QTreeWidget *m_fileTree;

    // State
    QString m_currentProjectId;
    QString m_currentBranchId;
    QString m_currentProjectName;
    QString m_currentBranchName;
    bool m_isProcessing;
};

#endif // CODEMODEVIEW_H
