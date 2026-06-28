#include "CodeModeView.h"
#include <QInputDialog>
#include <QMessageBox>
#include <QScrollBar>
#include <QTimer>
#include <QDateTime>
#include <QMenu>

CodeModeView::CodeModeView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_isProcessing(false)
{
    setupUI();
}

CodeModeView::~CodeModeView() {}

void CodeModeView::setupUI()
{
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    auto *splitter = new QSplitter(Qt::Horizontal, this);

    // ── LHS: Project tree + file tree ─────────────────────────────────────
    m_sidebar = new QWidget();
    auto *sidebarLayout = new QVBoxLayout(m_sidebar);
    sidebarLayout->setContentsMargins(8, 8, 8, 8);
    sidebarLayout->setSpacing(6);

    auto *sidebarHeader = new QLabel("⚡  Code Mode");
    sidebarHeader->setStyleSheet("font-size: 16px; font-weight: 700; color: #ffd43b; padding: 8px;");

    // Project header
    auto *projectHeader = new QWidget();
    auto *phLayout = new QHBoxLayout(projectHeader);
    phLayout->setContentsMargins(0, 0, 0, 0);

    m_projectLabel = new QLabel("Projects");
    m_projectLabel->setStyleSheet("font-size: 11px; font-weight: 600; color: #888;");

    m_newProjectBtn = new QPushButton("+");
    m_newProjectBtn->setFixedSize(24, 24);
    m_newProjectBtn->setCursor(Qt::PointingHandCursor);
    m_newProjectBtn->setStyleSheet(
        "QPushButton { background: #ffd43b; color: #000; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; }"
        "QPushButton:hover { background: #fcc419; }"
    );

    phLayout->addWidget(m_projectLabel);
    phLayout->addStretch();
    phLayout->addWidget(m_newProjectBtn);

    m_projectTree = new QTreeWidget();
    m_projectTree->setHeaderHidden(true);
    m_projectTree->setStyleSheet(
        "QTreeWidget { background: transparent; border: none; font-size: 11px; }"
        "QTreeWidget::item { padding: 6px; border-radius: 4px; }"
        "QTreeWidget::item:selected { background: #ffd43b22; color: #ffd43b; }"
        "QTreeWidget::item:hover { background: #1a1a1a; }"
    );

    // File tree
    auto *fileHeader = new QLabel("Files");
    fileHeader->setStyleSheet("font-size: 11px; font-weight: 600; color: #888; padding: 8px 0 4px 0;");

    m_fileTree = new QTreeWidget();
    m_fileTree->setHeaderHidden(true);
    m_fileTree->setStyleSheet(
        "QTreeWidget { background: transparent; border: none; font-size: 11px; font-family: 'Consolas', 'Courier New', monospace; }"
        "QTreeWidget::item { padding: 4px; border-radius: 3px; }"
        "QTreeWidget::item:selected { background: #ffd43b22; color: #ffd43b; }"
    );

    sidebarLayout->addWidget(sidebarHeader);
    sidebarLayout->addWidget(projectHeader);
    sidebarLayout->addWidget(m_projectTree);
    sidebarLayout->addWidget(fileHeader);
    sidebarLayout->addWidget(m_fileTree, 1);

    // ── Workspace: agent log + input ──────────────────────────────────────
    m_workspace = new QWidget();
    auto *workspaceLayout = new QVBoxLayout(m_workspace);
    workspaceLayout->setContentsMargins(0, 0, 0, 0);
    workspaceLayout->setSpacing(0);

    // Header bar with branch info
    auto *headerBar = new QWidget();
    headerBar->setStyleSheet("background: #1a1a1a; border-bottom: 1px solid #2a2a2a;");
    auto *headerH = new QHBoxLayout(headerBar);
    headerH->setContentsMargins(16, 10, 16, 10);

    m_branchLabel = new QLabel("Select a project to begin");
    m_branchLabel->setStyleSheet("font-size: 13px; font-weight: 600; color: #ffd43b;");

    m_newBranchBtn = new QPushButton("+ New Branch");
    m_newBranchBtn->setCursor(Qt::PointingHandCursor);
    m_newBranchBtn->setVisible(false);
    m_newBranchBtn->setStyleSheet(
        "QPushButton { background: #ffd43b22; color: #ffd43b; border: 1px solid #ffd43b44; border-radius: 6px;"
        "  padding: 6px 12px; font-size: 11px; }"
        "QPushButton:hover { background: #ffd43b33; }"
    );

    headerH->addWidget(m_branchLabel);
    headerH->addStretch();
    headerH->addWidget(m_newBranchBtn);

    // Agent log scroll area
    m_logScroll = new QScrollArea();
    m_logScroll->setWidgetResizable(true);
    m_logScroll->setStyleSheet("QScrollArea { background: #0d0d0d; border: none; }");

    m_logContainer = new QWidget();
    m_logLayout = new QVBoxLayout(m_logContainer);
    m_logLayout->setContentsMargins(16, 16, 16, 16);
    m_logLayout->setSpacing(4);
    m_logLayout->addStretch();

    m_logScroll->setWidget(m_logContainer);

    // Status
    m_statusLabel = new QLabel();
    m_statusLabel->setStyleSheet("font-size: 11px; color: #666; padding: 4px 16px; background: #0a0a0a;");

    // Prompt input
    auto *inputContainer = new QWidget();
    inputContainer->setStyleSheet("background: #0d0d0d; border-top: 1px solid #2a2a2a;");
    auto *inputLayout = new QHBoxLayout(inputContainer);
    inputLayout->setContentsMargins(12, 8, 12, 12);
    inputLayout->setSpacing(8);

    m_promptInput = new QTextEdit();
    m_promptInput->setPlaceholderText("Describe what you want to build...\nThe 9-agent team will plan, code, test, and deploy it.");
    m_promptInput->setMaximumHeight(80);
    m_promptInput->setAcceptRichText(false);
    m_promptInput->setStyleSheet(
        "QTextEdit { background: #1a1a1a; border: 1px solid #333; border-radius: 12px;"
        "  padding: 12px; font-size: 13px; color: #e0e0e0; }"
        "QTextEdit:focus { border-color: #ffd43b; }"
    );

    m_sendBtn = new QPushButton("⚡");
    m_sendBtn->setFixedSize(44, 44);
    m_sendBtn->setCursor(Qt::PointingHandCursor);
    m_sendBtn->setStyleSheet(
        "QPushButton { background: #ffd43b; color: #000; border: none; border-radius: 22px; font-size: 18px; }"
        "QPushButton:hover { background: #fcc419; }"
        "QPushButton:disabled { background: #333; color: #555; }"
    );
    m_sendBtn->setEnabled(false);

    inputLayout->addWidget(m_promptInput);
    inputLayout->addWidget(m_sendBtn);

    // Assemble
    workspaceLayout->addWidget(headerBar);
    workspaceLayout->addWidget(m_logScroll, 1);
    workspaceLayout->addWidget(m_statusLabel);
    workspaceLayout->addLayout(inputLayout);

    splitter->addWidget(m_sidebar);
    splitter->addWidget(m_workspace);
    splitter->setStretchFactor(0, 1);
    splitter->setStretchFactor(1, 3);
    splitter->setSizes({320, 800});

    mainLayout->addWidget(splitter);

    // Connections
    connect(m_newProjectBtn, &QPushButton::clicked, this, &CodeModeView::onNewProject);
    connect(m_newBranchBtn, &QPushButton::clicked, this, &CodeModeView::onCreateBranch);
    connect(m_sendBtn, &QPushButton::clicked, this, &CodeModeView::onSendPrompt);
    connect(m_projectTree, &QTreeWidget::itemClicked, this, [this](QTreeWidgetItem *item, int) {
        if (item->parent() == nullptr) {
            // It's a project
            m_currentProjectId = item->data(0, Qt::UserRole).toString();
            m_currentProjectName = item->text(0);
            m_branchLabel->setText("Project: " + m_currentProjectName);
            m_newBranchBtn->setVisible(true);
            loadBranches(m_currentProjectId);
        } else {
            // It's a branch
            m_currentBranchId = item->data(0, Qt::UserRole).toString();
            m_currentBranchName = item->text(0);
            m_branchLabel->setText(m_currentProjectName + " / " + m_currentBranchName);
            m_sendBtn->setEnabled(true);
            m_statusLabel->setText("Ready in branch: " + m_currentBranchName);
        }
    });
    connect(m_promptInput, &QTextEdit::textChanged, this, [this]() {
        m_sendBtn->setEnabled(!m_promptInput->toPlainText().trimmed().isEmpty() && !m_currentBranchId.isEmpty());
    });
}

void CodeModeView::appendAgentMessage(const QString &agent, const QString &content)
{
    auto *entry = new QWidget();
    entry->setStyleSheet("background: #1a1a1a; border-radius: 8px; padding: 8px;");
    auto *layout = new QVBoxLayout(entry);
    layout->setContentsMargins(10, 6, 10, 6);
    layout->setSpacing(4);

    // Agent color mapping
    static QMap<QString, QString> agentColors = {
        {"Researcher", "#74c0fc"}, {"Analyser", "#9775fa"}, {"Planner", "#ffd43b"},
        {"Coder", "#51cf66"}, {"Optimiser", "#f783ac"}, {"Organizer", "#ff922b"},
        {"Tester", "#20c997"}, {"Hacker", "#ff6b6b"}, {"Critic", "#da77f2"},
    };

    QString color = agentColors.value(agent, "#aaa");

    auto *header = new QLabel(
        QString("<span style='color:%1; font-weight:700; font-size:12px;'>■ %2</span>"
                " <span style='color:#555; font-size:10px;'>%3</span>")
        .arg(color, agent, QDateTime::currentDateTime().toString("h:mm:ss AP"))
    );
    header->setTextFormat(Qt::RichText);

    auto *contentLabel = new QLabel(m_mdRenderer->renderToHtml(content));
    contentLabel->setTextFormat(Qt::RichText);
    contentLabel->setWordWrap(true);
    contentLabel->setStyleSheet("font-size: 12px; color: #ccc; background: transparent;");

    layout->addWidget(header);
    layout->addWidget(contentLabel);

    m_logLayout->insertWidget(m_logLayout->count() - 1, entry);

    QTimer::singleShot(50, this, [this]() {
        m_logScroll->verticalScrollBar()->setValue(
            m_logScroll->verticalScrollBar()->maximum()
        );
    });
}

void CodeModeView::addLogEntry(const QString &level, const QString &message)
{
    QString color = (level == "error") ? "#ff6b6b" : (level == "warning") ? "#ffd43b" : "#888";
    auto *entry = new QLabel(
        QString("<span style='color:%1; font-size:11px; font-family:monospace;'>%2</span>")
        .arg(color, message)
    );
    entry->setTextFormat(Qt::RichText);
    entry->setWordWrap(true);

    m_logLayout->insertWidget(m_logLayout->count() - 1, entry);
}

void CodeModeView::onNewProject()
{
    bool ok;
    QString name = QInputDialog::getText(this, "New Project", "Project name:", QLineEdit::Normal, "", &ok);
    if (!ok || name.trimmed().isEmpty()) return;

    QJsonObject args;
    args["name"] = name.trimmed();
    args["description"] = "Created from desktop app";

    m_client->mutation("codeProjects:create", args);
    m_statusLabel->setText("Creating project: " + name);

    connect(m_client, &ConvexClient::mutationResult, this, [this, name](const QJsonValue &result) {
        Q_UNUSED(result);
        loadProjects();
        m_statusLabel->setText("Project created: " + name);
    }, Qt::SingleShotConnection);
}

void CodeModeView::onCreateBranch()
{
    bool ok;
    QString name = QInputDialog::getText(this, "New Branch", "Branch name:", QLineEdit::Normal, "", &ok);
    if (!ok || name.trimmed().isEmpty()) return;

    if (m_currentProjectId.isEmpty()) return;

    QJsonObject args;
    args["projectId"] = m_currentProjectId;
    args["name"] = name.trimmed();

    m_client->mutation("codeBranches:create", args);
    m_statusLabel->setText("Creating branch: " + name);

    connect(m_client, &ConvexClient::mutationResult, this, [this, name](const QJsonValue &result) {
        Q_UNUSED(result);
        loadBranches(m_currentProjectId);
        m_statusLabel->setText("Branch created: " + name);
    }, Qt::SingleShotConnection);
}

void CodeModeView::onSelectProject()
{
    loadProjects();
}

void CodeModeView::onSendPrompt()
{
    QString prompt = m_promptInput->toPlainText().trimmed();
    if (prompt.isEmpty() || m_currentBranchId.isEmpty() || m_isProcessing) return;

    m_promptInput->clear();
    m_sendBtn->setEnabled(false);
    m_isProcessing = true;

    appendAgentMessage("User", prompt);
    m_statusLabel->setText("Starting 9-agent pipeline...");

    QJsonObject args;
    args["branchId"] = m_currentBranchId;
    args["task"] = prompt;

    m_client->mutation("codePipeline:start", args);

    // Poll for agent messages via query
    m_statusLabel->setText("Pipeline started — watching for agent outputs...");
    m_isProcessing = false;
    m_sendBtn->setEnabled(true);
}

void CodeModeView::onAgentMessage(const QJsonObject &msg)
{
    QString agent = msg["agent"].toString();
    QString content = msg["content"].toString();
    if (!agent.isEmpty() && !content.isEmpty()) {
        appendAgentMessage(agent, content);
    }
}

void CodeModeView::loadProjects()
{
    m_client->query("codeProjects:list", QJsonObject{});
    connect(m_client, &ConvexClient::queryResult, this, [this](const QJsonValue &result) {
        m_projectTree->clear();
        QJsonArray projects = result.toArray();
        for (const QJsonValue &val : projects) {
            QJsonObject proj = val.toObject();
            auto *item = new QTreeWidgetItem({proj["name"].toString()});
            item->setData(0, Qt::UserRole, proj["projectId"].toString());
            item->setIcon(0, style()->standardIcon(QStyle::SP_DirIcon));
            m_projectTree->addTopLevelItem(item);
        }
    }, Qt::SingleShotConnection);
}

void CodeModeView::loadBranches(const QString &projectId)
{
    QJsonObject args;
    args["projectId"] = projectId;
    m_client->query("codeBranches:list", args);

    connect(m_client, &ConvexClient::queryResult, this, [this](const QJsonValue &result) {
        Q_UNUSED(result);
        // Expand the selected project item
        auto items = m_projectTree->selectedItems();
        if (!items.isEmpty()) {
            auto *projectItem = items.first();
            // Remove old branch children
            while (projectItem->childCount() > 0)
                delete projectItem->takeChild(0);

            QJsonArray branches = result.toArray();
            for (const QJsonValue &val : branches) {
                QJsonObject branch = val.toObject();
                auto *branchItem = new QTreeWidgetItem({"🌿  " + branch["name"].toString()});
                branchItem->setData(0, Qt::UserRole, branch["branchId"].toString());
                projectItem->addChild(branchItem);
            }
            projectItem->setExpanded(true);
        }
    }, Qt::SingleShotConnection);
}

void CodeModeView::updateFileTree(const QJsonArray &files)
{
    m_fileTree->clear();
    for (const QJsonValue &val : files) {
        QString path = val.toString();
        auto *item = new QTreeWidgetItem({path});
        item->setIcon(0, style()->standardIcon(QStyle::SP_FileIcon));
        m_fileTree->addTopLevelItem(item);
    }
}
