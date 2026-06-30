// Thalamus AI — StudyView.cpp
#include "StudyView.h"
#include "ConvexClient.h"
#include "MarkdownRenderer.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QScrollBar>
#include <QFileDialog>
#include <QMessageBox>

StudyView::StudyView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this))
    , m_isStudying(false)
{
    setupUi();
}

void StudyView::setupUi()
{
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(8);
    layout->setContentsMargins(16, 16, 16, 16);

    // Header
    auto *header = new QLabel("Study Mode");
    header->setStyleSheet("font-size: 18px; font-weight: bold; color: #c0c0f0;");
    layout->addWidget(header);

    auto *description = new QLabel(
        "Upload study materials (PDF, text, notes) and ask questions. "
        "The AI will search your materials for relevant context.");
    description->setWordWrap(true);
    description->setStyleSheet("color: #8080a0; font-size: 13px; margin-bottom: 8px;");
    layout->addWidget(description);

    // Splitter: Materials + Study area
    auto *splitter = new QSplitter(Qt::Horizontal, this);

    // Materials panel
    auto *materialsContainer = new QWidget;
    auto *materialsLayout = new QVBoxLayout(materialsContainer);
    materialsLayout->setContentsMargins(0, 0, 0, 0);
    materialsLayout->setSpacing(8);

    auto *materialsHeader = new QLabel("Uploaded Materials");
    materialsHeader->setStyleSheet("color: #a0a0c0; font-size: 13px; font-weight: bold;");
    materialsLayout->addWidget(materialsHeader);

    m_uploadButton = new QPushButton("+ Upload");
    m_uploadButton->setCursor(Qt::PointingHandCursor);
    m_uploadButton->setStyleSheet(
        "QPushButton { padding: 8px 16px; border: 1px dashed #3e3e5e; border-radius: 6px; "
        "background: transparent; color: #8080a0; font-size: 13px; }"
        "QPushButton:hover { border-color: #6e6eff; color: #c0c0f0; }"
    );
    connect(m_uploadButton, &QPushButton::clicked, this, &StudyView::onUploadMaterial);
    materialsLayout->addWidget(m_uploadButton);

    m_materialList = new QListWidget;
    m_materialList->setStyleSheet(
        "QListWidget { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "color: #c0c0e0; font-size: 13px; }"
        "QListWidget::item { padding: 8px 12px; border-bottom: 1px solid #1e1e32; }"
        "QListWidget::item:selected { background: #2a2a4a; }"
    );
    materialsLayout->addWidget(m_materialList, 1);

    materialsContainer->setMinimumWidth(200);
    splitter->addWidget(materialsContainer);

    // Study display
    m_studyDisplay = new QTextEdit;
    m_studyDisplay->setReadOnly(true);
    m_studyDisplay->setStyleSheet(
        "QTextEdit { background: #16162a; border: 1px solid #2e2e4e; border-radius: 6px; "
        "padding: 16px; color: #d0d0e8; font-size: 14px; }"
    );
    splitter->addWidget(m_studyDisplay);

    layout->addWidget(splitter, 1);

    // Question input
    auto *inputLayout = new QHBoxLayout;
    m_questionInput = new QLineEdit;
    m_questionInput->setPlaceholderText("Ask a question about your materials...");
    m_questionInput->setStyleSheet(
        "QLineEdit { padding: 12px; border: 1px solid #3e3e5e; border-radius: 8px; "
        "background: #16162a; color: #e0e0f0; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6e6eff; }"
    );
    connect(m_questionInput, &QLineEdit::returnPressed, this, &StudyView::onAskQuestion);
    inputLayout->addWidget(m_questionInput, 1);

    m_askButton = new QPushButton("Ask");
    m_askButton->setCursor(Qt::PointingHandCursor);
    m_askButton->setStyleSheet(
        "QPushButton { padding: 10px 20px; border: none; border-radius: 8px; "
        "background: #4a4aff; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #5a5aff; }"
        "QPushButton:disabled { background: #2a2a4a; color: #606080; }"
    );
    connect(m_askButton, &QPushButton::clicked, this, &StudyView::onAskQuestion);
    inputLayout->addWidget(m_askButton);

    m_stopButton = new QPushButton("Stop");
    m_stopButton->setCursor(Qt::PointingHandCursor);
    m_stopButton->setStyleSheet(
        "QPushButton { padding: 10px 20px; border: none; border-radius: 8px; "
        "background: #ff4a4a; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #ff5a5a; }"
    );
    m_stopButton->hide();
    connect(m_stopButton, &QPushButton::clicked, this, [this]() {
        m_client->cancelStream();
        onStreamDone();
    });
    inputLayout->addWidget(m_stopButton);

    layout->addLayout(inputLayout);
}

void StudyView::onAskQuestion()
{
    QString question = m_questionInput->text().trimmed();
    if (question.isEmpty()) return;

    m_studyDisplay->append(
        QString("<p style='color:#8080c0; margin-top:12px;'><b>Q:</b> %1</p>")
            .arg(question.toHtmlEscaped()));

    m_questionInput->clear();
    m_currentAnswer.clear();
    setInputEnabled(false);
    m_isStudying = true;

    m_client->startChatStream(
        question, "study",
        [this](const QString &chunk) { onStreamChunk(chunk); },
        [this]() { onStreamDone(); }
    );
}

void StudyView::onStreamChunk(const QString &text)
{
    m_currentAnswer += text;
    m_studyDisplay->setHtml(m_mdRenderer->render(m_currentAnswer));
    QScrollBar *scrollBar = m_studyDisplay->verticalScrollBar();
    if (scrollBar) scrollBar->setValue(scrollBar->maximum());
}

void StudyView::onStreamDone()
{
    m_isStudying = false;
    setInputEnabled(true);
    m_studyDisplay->append("");
}

void StudyView::onUploadMaterial()
{
    QStringList files = QFileDialog::getOpenFileNames(
        this, "Upload Study Materials", QString(),
        "Documents (*.pdf *.txt *.md *.html);;All Files (*)");

    for (const QString &file : files) {
        QFileInfo info(file);
        m_materialList->addItem(info.fileName());
    }

    if (!files.isEmpty()) {
        // In a full implementation, we would upload the files to Convex
        // For now, we show them in the list
        QMessageBox::information(this, "Upload",
            QString("%1 file(s) added to study materials.\n\n"
                    "Full file upload to Convex storage will be implemented "
                    "in a future update.")
                .arg(files.size()));
    }
}

void StudyView::setInputEnabled(bool enabled)
{
    m_questionInput->setEnabled(enabled);
    m_askButton->setVisible(enabled);
    m_stopButton->setVisible(!enabled);
    if (enabled) m_questionInput->setFocus();
}
