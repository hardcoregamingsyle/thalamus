// Thalamus AI — StudyView.cpp
#include "StudyView.h"
#include "ConvexClient.h"
#include "MarkdownRenderer.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QScrollBar>
#include <QFileDialog>
#include <QFileInfo>
#include <QMessageBox>

StudyView::StudyView(ConvexClient *client, QWidget *parent)
    : QWidget(parent), m_client(client)
    , m_mdRenderer(new MarkdownRenderer(this)), m_isStudying(false)
{ setupUi(); }

void StudyView::setupUi()
{
    auto *l = new QVBoxLayout(this); l->setSpacing(8); l->setContentsMargins(16,16,16,16);
    auto *h = new QLabel("Study Mode");
    h->setStyleSheet("font-size:18px; font-weight:bold; color:#c0c0f0;");
    l->addWidget(h);
    auto *d = new QLabel("Upload materials and ask questions with RAG search.");
    d->setWordWrap(true); d->setStyleSheet("color:#8080a0; font-size:13px; margin-bottom:8px;");
    l->addWidget(d);

    auto *sp = new QSplitter(Qt::Horizontal, this);
    auto *mc = new QWidget;
    auto *ml2 = new QVBoxLayout(mc); ml2->setContentsMargins(0,0,0,0); ml2->setSpacing(8);
    auto *mh = new QLabel("Uploaded Materials");
    mh->setStyleSheet("color:#a0a0c0; font-size:13px; font-weight:bold;");
    ml2->addWidget(mh);
    m_uploadButton = new QPushButton("+ Upload");
    m_uploadButton->setCursor(Qt::PointingHandCursor);
    m_uploadButton->setStyleSheet(
        "QPushButton { padding:8px 16px; border:1px dashed #3e3e5e; border-radius:6px; "
        "background:transparent; color:#8080a0; font-size:13px; }"
        "QPushButton:hover { border-color:#6e6eff; color:#c0c0f0; }");
    connect(m_uploadButton, &QPushButton::clicked, this, &StudyView::onUploadMaterial);
    ml2->addWidget(m_uploadButton);
    m_materialList = new QListWidget;
    m_materialList->setStyleSheet(
        "QListWidget { background:#16162a; border:1px solid #2e2e4e; border-radius:6px; "
        "color:#c0c0e0; font-size:13px; }"
        "QListWidget::item { padding:8px 12px; border-bottom:1px solid #1e1e32; }"
        "QListWidget::item:selected { background:#2a2a4a; }");
    ml2->addWidget(m_materialList, 1);
    mc->setMinimumWidth(200); sp->addWidget(mc);

    m_studyDisplay = new QTextEdit;
    m_studyDisplay->setReadOnly(true);
    m_studyDisplay->setStyleSheet(
        "QTextEdit { background:#16162a; border:1px solid #2e2e4e; border-radius:6px; "
        "padding:16px; color:#d0d0e8; font-size:14px; }");
    sp->addWidget(m_studyDisplay);
    l->addWidget(sp, 1);

    auto *il = new QHBoxLayout;
    m_questionInput = new QLineEdit;
    m_questionInput->setPlaceholderText("Ask a question about your materials...");
    m_questionInput->setStyleSheet(
        "QLineEdit { padding:12px; border:1px solid #3e3e5e; border-radius:8px; "
        "background:#16162a; color:#e0e0f0; font-size:14px; }"
        "QLineEdit:focus { border-color:#6e6eff; }");
    connect(m_questionInput, &QLineEdit::returnPressed, this, &StudyView::onAskQuestion);
    il->addWidget(m_questionInput, 1);
    m_askButton = new QPushButton("Ask");
    m_askButton->setCursor(Qt::PointingHandCursor);
    m_askButton->setStyleSheet(
        "QPushButton { padding:10px 20px; border:none; border-radius:8px; "
        "background:#4a4aff; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#5a5aff; }");
    connect(m_askButton, &QPushButton::clicked, this, &StudyView::onAskQuestion);
    il->addWidget(m_askButton);
    m_stopButton = new QPushButton("Stop");
    m_stopButton->setCursor(Qt::PointingHandCursor);
    m_stopButton->setStyleSheet(
        "QPushButton { padding:10px 20px; border:none; border-radius:8px; "
        "background:#ff4a4a; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#ff5a5a; }");
    m_stopButton->hide();
    connect(m_stopButton, &QPushButton::clicked, this, [this]() { m_client->cancelStream(); onStreamDone(); });
    il->addWidget(m_stopButton);
    l->addLayout(il);
}

void StudyView::onAskQuestion()
{
    QString q = m_questionInput->text().trimmed();
    if (q.isEmpty()) return;
    m_studyDisplay->append(
        QString("<p style='color:#8080c0; margin-top:12px;'><b>Q:</b> %1</p>").arg(q.toHtmlEscaped()));
    m_questionInput->clear(); m_currentAnswer.clear();
    setInputEnabled(false); m_isStudying = true;
    m_client->startChatStream(q, "study",
        [this](const QString &c) { onStreamChunk(c); },
        [this]() { onStreamDone(); });
}

void StudyView::onStreamChunk(const QString &text)
{
    m_currentAnswer += text;
    m_studyDisplay->setHtml(m_mdRenderer->render(m_currentAnswer));
    QScrollBar *sb = m_studyDisplay->verticalScrollBar();
    if (sb) sb->setValue(sb->maximum());
}

void StudyView::onStreamDone()
{
    m_isStudying = false; setInputEnabled(true); m_studyDisplay->append("");
}

void StudyView::onUploadMaterial()
{
    QStringList files = QFileDialog::getOpenFileNames(
        this, "Upload Study Materials", QString(),
        "Documents (*.pdf *.txt *.md *.html);;All Files (*)");
    for (const QString &f : files) { m_materialList->addItem(QFileInfo(f).fileName()); }
    if (!files.isEmpty())
        QMessageBox::information(this, "Upload",
            QString("%1 file(s) added. Full Convex upload coming soon.").arg(files.size()));
}

void StudyView::setInputEnabled(bool en)
{
    m_questionInput->setEnabled(en); m_askButton->setVisible(en);
    m_stopButton->setVisible(!en);
    if (en) m_questionInput->setFocus();
}
