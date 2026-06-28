#include "StudyView.h"
#include <QFileDialog>
#include <QMessageBox>
#include <QSplitter>
#include <QScrollBar>
#include <QTimer>
#include <QDateTime>
#include <QFile>
#include <QTextStream>

StudyView::StudyView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_isAsking(false)
{
    setupUI();
}

StudyView::~StudyView() {}

void StudyView::setupUI()
{
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    auto *splitter = new QSplitter(Qt::Horizontal, this);

    // ── Sidebar: Resources ────────────────────────────────────────────────
    m_sidebar = new QWidget();
    auto *sidebarLayout = new QVBoxLayout(m_sidebar);
    sidebarLayout->setContentsMargins(8, 8, 8, 8);
    sidebarLayout->setSpacing(8);

    auto *sidebarHeader = new QLabel("📚  Study Materials");
    sidebarHeader->setStyleSheet("font-size: 16px; font-weight: 700; color: #fff; padding: 8px;");

    auto *sidebarSubtitle = new QLabel("Upload your notes, textbooks, or articles\nfor AI-powered study assistance.");
    sidebarSubtitle->setStyleSheet("font-size: 11px; color: #888; padding: 0 8px;");
    sidebarSubtitle->setWordWrap(true);

    m_uploadBtn = new QPushButton("+ Upload Material");
    m_uploadBtn->setCursor(Qt::PointingHandCursor);
    m_uploadBtn->setStyleSheet(
        "QPushButton { background: #51cf66; color: #fff; border: none; border-radius: 8px;"
        "  padding: 10px; font-size: 12px; font-weight: 600; }"
        "QPushButton:hover { background: #40c057; }"
    );

    m_resourceList = new QListWidget();
    m_resourceList->setStyleSheet(
        "QListWidget { background: transparent; border: none; }"
        "QListWidget::item { padding: 8px; border-radius: 6px; margin: 2px 0; font-size: 11px; }"
        "QListWidget::item:selected { background: #51cf6622; color: #51cf66; }"
        "QListWidget::item:hover { background: #1a1a1a; }"
    );

    sidebarLayout->addWidget(sidebarHeader);
    sidebarLayout->addWidget(sidebarSubtitle);
    sidebarLayout->addWidget(m_uploadBtn);
    sidebarLayout->addWidget(m_resourceList);

    // ── Main area ─────────────────────────────────────────────────────────
    m_mainArea = new QWidget();
    auto *chatLayout = new QVBoxLayout(m_mainArea);
    chatLayout->setContentsMargins(0, 0, 0, 0);
    chatLayout->setSpacing(0);

    // Header bar
    auto *headerBar = new QWidget();
    headerBar->setStyleSheet("background: #1a1a1a; border-bottom: 1px solid #2a2a2a;");
    auto *headerH = new QHBoxLayout(headerBar);
    headerH->setContentsMargins(16, 12, 16, 12);

    auto *headerTitle = new QLabel("📚  Study Mode");
    headerTitle->setStyleSheet("font-size: 18px; font-weight: 700; color: #51cf66;");

    m_modeCombo = new QComboBox();
    m_modeCombo->addItems({"RAG + Knowledge Graph", "RAG Only", "AI Tutor Only"});
    m_modeCombo->setStyleSheet(
        "QComboBox { background: #0d0d0d; border: 1px solid #333; border-radius: 6px;"
        "  padding: 6px 12px; font-size: 11px; color: #e0e0e0; }"
        "QComboBox:hover { border-color: #51cf66; }"
    );

    m_clearBtn = new QPushButton("Clear");
    m_clearBtn->setCursor(Qt::PointingHandCursor);
    m_clearBtn->setStyleSheet(
        "QPushButton { background: transparent; color: #888; border: 1px solid #333; border-radius: 6px; padding: 6px 12px; font-size: 11px; }"
        "QPushButton:hover { color: #ccc; border-color: #555; }"
    );

    headerH->addWidget(headerTitle);
    headerH->addWidget(m_modeCombo);
    headerH->addStretch();
    headerH->addWidget(m_clearBtn);

    // Chat scroll area
    m_chatScroll = new QScrollArea();
    m_chatScroll->setWidgetResizable(true);
    m_chatScroll->setStyleSheet("QScrollArea { background: #111; border: none; }");

    m_chatContainer = new QWidget();
    m_chatLayout = new QVBoxLayout(m_chatContainer);
    m_chatLayout->setContentsMargins(16, 16, 16, 16);
    m_chatLayout->setSpacing(12);
    m_chatLayout->addStretch();

    m_chatScroll->setWidget(m_chatContainer);

    // Progress bar
    m_progressBar = new QProgressBar();
    m_progressBar->setVisible(false);
    m_progressBar->setRange(0, 0);
    m_progressBar->setFixedHeight(4);
    m_progressBar->setStyleSheet(
        "QProgressBar { background: #1a1a1a; border: none; }"
        "QProgressBar::chunk { background: #51cf66; border-radius: 2px; }"
    );

    // Input area
    auto *inputContainer = new QWidget();
    inputContainer->setStyleSheet("background: #0d0d0d; border-top: 1px solid #2a2a2a;");
    auto *inputLayout = new QHBoxLayout(inputContainer);
    inputLayout->setContentsMargins(12, 8, 12, 12);
    inputLayout->setSpacing(8);

    m_questionInput = new QTextEdit();
    m_questionInput->setPlaceholderText("Ask a question about your study materials...");
    m_questionInput->setMaximumHeight(80);
    m_questionInput->setAcceptRichText(false);
    m_questionInput->setStyleSheet(
        "QTextEdit { background: #1a1a1a; border: 1px solid #333; border-radius: 12px;"
        "  padding: 12px; font-size: 13px; color: #e0e0e0; }"
        "QTextEdit:focus { border-color: #51cf66; }"
    );

    m_askBtn = new QPushButton("➤");
    m_askBtn->setFixedSize(44, 44);
    m_askBtn->setCursor(Qt::PointingHandCursor);
    m_askBtn->setStyleSheet(
        "QPushButton { background: #51cf66; color: #fff; border: none; border-radius: 22px; font-size: 18px; }"
        "QPushButton:hover { background: #40c057; }"
        "QPushButton:disabled { background: #333; color: #555; }"
    );
    m_askBtn->setEnabled(false);

    m_statusLabel = new QLabel();
    m_statusLabel->setStyleSheet("font-size: 11px; color: #666; padding: 0 8px;");

    inputLayout->addWidget(m_questionInput);
    inputLayout->addWidget(m_askBtn);

    // Assemble
    chatLayout->addWidget(headerBar);
    chatLayout->addWidget(m_chatScroll, 1);
    chatLayout->addWidget(m_progressBar);
    chatLayout->addWidget(m_statusLabel);
    chatLayout->addLayout(inputLayout);

    splitter->addWidget(m_sidebar);
    splitter->addWidget(m_mainArea);
    splitter->setStretchFactor(0, 1);
    splitter->setStretchFactor(1, 3);
    splitter->setSizes({280, 800});

    mainLayout->addWidget(splitter);

    // Connections
    connect(m_askBtn, &QPushButton::clicked, this, &StudyView::onAskQuestion);
    connect(m_uploadBtn, &QPushButton::clicked, this, &StudyView::onUploadMaterial);
    connect(m_clearBtn, &QPushButton::clicked, this, &StudyView::onClearStudy);
    connect(m_questionInput, &QTextEdit::textChanged, this, [this]() {
        m_askBtn->setEnabled(!m_questionInput->toPlainText().trimmed().isEmpty());
    });
}

void StudyView::onAskQuestion()
{
    QString question = m_questionInput->toPlainText().trimmed();
    if (question.isEmpty() || m_isAsking) return;

    m_questionInput->clear();
    m_askBtn->setEnabled(false);
    m_isAsking = true;

    appendMessage("user", question);
    m_progressBar->setVisible(true);
    m_statusLabel->setText("Researching your materials...");

    QString modeDesc = m_modeCombo->currentText();
    QString systemPrompt = QString(
        "You are a study assistant powered by RAG (Retrieval Augmented Generation) "
        "and knowledge graph technology. The user has uploaded study materials. "
        "Answer questions based on those materials. "
        "Mode: %1\n"
        "Current date: %2\n\n"
        "Be thorough, educational, and cite specific concepts from the materials. "
        "If the answer isn't in the materials, say so clearly."
    ).arg(modeDesc, QDateTime::currentDateTime().toString("MMMM d, yyyy"));

    QJsonArray history;
    m_client->streamChat(
        question, "study", history, systemPrompt,
        "", m_client->authToken(),
        [this](const QString &chunk) {
            Q_UNUSED(chunk);
        },
        [this, question](const QString &text, bool success) {
            m_isAsking = false;
            m_progressBar->setVisible(false);
            m_askBtn->setEnabled(true);
            m_statusLabel->setText(success ? "Answer ready" : "Failed to generate answer");

            if (success && !text.isEmpty()) {
                appendMessage("assistant", text);
            }
        }
    );
}

void StudyView::appendMessage(const QString &role, const QString &content)
{
    QString prefix = (role == "user") ? "👤  You" : "📚  Study Assistant";
    QString color = (role == "user") ? "#51cf66" : "#a78bfa";

    auto *msgWidget = new QWidget();
    msgWidget->setStyleSheet(QString("background: %1; border-radius: 12px; padding: 12px;")
                             .arg(role == "user" ? "#1a1a1a" : "#0d0d0d"));

    auto *layout = new QVBoxLayout(msgWidget);
    layout->setContentsMargins(12, 8, 12, 8);
    layout->setSpacing(6);

    auto *header = new QLabel(QString("<span style='font-size:11px; font-weight:600; color:%1;'>%2</span>"
                                      " <span style='font-size:10px; color:#555;'>%3</span>")
                              .arg(color, prefix, QDateTime::currentDateTime().toString("h:mm AP")));
    header->setTextFormat(Qt::RichText);

    auto *contentLabel = new QLabel(m_mdRenderer->renderToHtml(content));
    contentLabel->setTextFormat(Qt::RichText);
    contentLabel->setWordWrap(true);
    contentLabel->setStyleSheet("font-size: 13px; color: #e0e0e0; background: transparent;");

    auto *hLayout = new QHBoxLayout();
    if (role == "user") hLayout->addStretch();
    hLayout->addWidget(contentLabel);
    if (role != "user") hLayout->addStretch();

    layout->addWidget(header);
    layout->addLayout(hLayout);

    m_chatLayout->insertWidget(m_chatLayout->count() - 1, msgWidget);

    QTimer::singleShot(50, this, [this]() {
        m_chatScroll->verticalScrollBar()->setValue(
            m_chatScroll->verticalScrollBar()->maximum()
        );
    });
}

void StudyView::onUploadMaterial()
{
    QString filePath = QFileDialog::getOpenFileName(
        this,
        "Upload Study Material",
        QString(),
        "Text Files (*.txt *.md);;PDF Files (*.pdf);;All Files (*.*)"
    );

    if (filePath.isEmpty()) return;

    QFile file(filePath);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        QMessageBox::warning(this, "Error", "Could not open file: " + filePath);
        return;
    }

    QString content = QTextStream(&file).readAll();
    file.close();

    QFileInfo fi(filePath);
    QString title = fi.fileName();

    // Upload via Convex mutation
    QJsonObject args;
    args["title"] = title;
    args["content"] = content;
    args["sourceType"] = "file_upload";
    args["fileName"] = title;
    args["fileType"] = fi.suffix();

    m_client->mutation("studyResources:create", args);
    addResourceItem(title, "");
    m_statusLabel->setText("Uploaded: " + title);
}

void StudyView::onClearStudy()
{
    while (m_chatLayout->count() > 1) {
        QLayoutItem *item = m_chatLayout->takeAt(0);
        if (item->widget()) delete item->widget();
        delete item;
    }
    m_statusLabel->setText("Study session cleared");
}

void StudyView::loadResources()
{
    m_client->query("studyResources:list", QJsonObject{});
}

void StudyView::addResourceItem(const QString &title, const QString &id)
{
    auto *item = new QListWidgetItem("📄  " + title);
    item->setData(Qt::UserRole, id);
    m_resourceList->addItem(item);
}
