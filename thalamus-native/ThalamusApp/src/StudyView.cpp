/**
 * Thalamus AI — Study View
 * RAG-enhanced learning with uploaded materials.
 * Dense, exam-ready information delivery.
 */

#include "StudyView.h"
#include "ConvexClient.h"

#include <QScrollArea>
#include <QScrollBar>
#include <QLabel>

static const QString STUDY_SYSTEM_PROMPT =
    "You are Thalamus AI Study Mode — a precision study assistant. "
    "Give dense, accurate, exam-ready information. "
    "Use headings, bullet points, key facts with highlights, and clear definitions.";

StudyView::StudyView(ConvexClient *client, QWidget *parent)
    : QWidget(parent)
    , m_client(client)
    , m_mainLayout(new QVBoxLayout(this))
    , m_scrollArea(new QScrollArea(this))
    , m_messagesContainer(new QWidget())
    , m_messagesLayout(new QVBoxLayout(m_messagesContainer))
    , m_input(new QLineEdit(this))
    , m_sendBtn(new QPushButton("→", this))
    , m_statusLabel(new QLabel(this))
    , m_currentAssistant(nullptr)
    , m_streaming(false)
{
    setupUi();

    appendMessage("assistant",
        "<div style='padding: 20px; text-align: center;'>"
        "<h1 style='color: #f9fafb; font-size: 24px;'>📚 Study Mode</h1>"
        "<p style='color: #9ca3af; font-size: 14px; margin-top: 8px;'>"
        "Precision study assistant for exam preparation.</p>"
        "<p style='color: #6b7280; font-size: 12px; margin-top: 4px;'>"
        "Ask about any topic for dense, exam-ready explanations.</p>"
        "</div>");
}

void StudyView::setupUi() {
    m_mainLayout->setContentsMargins(0, 0, 0, 0);
    m_mainLayout->setSpacing(0);

    m_scrollArea->setWidgetResizable(true);
    m_scrollArea->setWidget(m_messagesContainer);
    m_scrollArea->setFrameShape(QFrame::NoFrame);
    m_scrollArea->setStyleSheet("QScrollArea { background: #0d1117; }");

    m_messagesLayout->setContentsMargins(16, 16, 16, 16);
    m_messagesLayout->setSpacing(12);
    m_messagesLayout->addStretch();

    m_mainLayout->addWidget(m_scrollArea, 1);

    m_statusLabel->setStyleSheet("color: #9ca3af; font-size: 11px; padding: 4px 16px;");
    m_statusLabel->hide();
    m_mainLayout->addWidget(m_statusLabel);

    auto *inputBar = new QWidget(this);
    inputBar->setStyleSheet("QWidget { background: #0d1117; border-top: 1px solid #1f2937; }");
    auto *inputLayout = new QHBoxLayout(inputBar);
    inputLayout->setContentsMargins(16, 12, 16, 16);

    m_input->setPlaceholderText("What would you like to study?");
    m_input->setStyleSheet(
        "QLineEdit { padding: 12px 16px; border: 1px solid #374151; border-radius: 12px; "
        "background: #111827; color: #e5e7eb; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6366f1; }");
    inputLayout->addWidget(m_input, 1);

    m_sendBtn->setFixedSize(44, 44);
    m_sendBtn->setStyleSheet(
        "QPushButton { background: #6366f1; color: white; border: none; border-radius: 12px; "
        "font-size: 18px; font-weight: bold; }"
        "QPushButton:hover { background: #818cf8; }");
    inputLayout->addWidget(m_sendBtn);

    m_mainLayout->addWidget(inputBar);

    connect(m_sendBtn, &QPushButton::clicked, this, &StudyView::onSendClicked);
    connect(m_input, &QLineEdit::returnPressed, this, &StudyView::onSendClicked);
    connect(m_client, &ConvexClient::streamChunk, this, &StudyView::onStreamChunk);
    connect(m_client, &ConvexClient::streamDone, this, &StudyView::onStreamDone);
    connect(m_client, &ConvexClient::streamError, this, &StudyView::onStreamError);
}

void StudyView::onSendClicked() {
    QString text = m_input->text().trimmed();
    if (!text.isEmpty() && !m_streaming) {
        m_input->clear();
        startStudy(text);
    }
}

void StudyView::startStudy(const QString &question) {
    m_streaming = true;
    m_input->setEnabled(false);
    m_sendBtn->setEnabled(false);
    m_statusLabel->setText("📚 Studying...");
    m_statusLabel->show();

    appendMessage("user", QString("<div style='color: #e5e7eb;'>%1</div>").arg(question.toHtmlEscaped()));
    m_history.append(QJsonObject{{"role", "user"}, {"content", question}});

    m_client->streamChat(question, "study", m_history, STUDY_SYSTEM_PROMPT);
}

void StudyView::appendMessage(const QString &role, const QString &html) {
    auto *msgWidget = new QWidget();
    auto *msgLayout = new QVBoxLayout(msgWidget);
    msgLayout->setContentsMargins(0, 0, 0, 0);

    auto *browser = new QTextBrowser();
    browser->setOpenExternalLinks(true);
    browser->setFrameShape(QFrame::NoFrame);
    browser->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    browser->document()->setDefaultStyleSheet(
        "body { font-family: 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; }"
        "h1, h2, h3 { color: #f9fafb; }"
        "p { color: #d1d5db; }"
        "code { background: #1f2937; color: #34d399; padding: 2px 6px; border-radius: 4px; font-family: monospace; }"
        "pre { background: #111827; color: #34d399; padding: 12px; border-radius: 8px; }"
        "a { color: #60a5fa; }"
        "blockquote { border-left: 3px solid #f59e0b; padding-left: 12px; color: #fcd34d; }"
        "ul, ol { margin: 4px 0; padding-left: 20px; color: #d1d5db; }"
    );

    if (role == "assistant") m_currentAssistant = browser;

    browser->setHtml(html);
    msgLayout->addWidget(browser);

    int count = m_messagesLayout->count();
    m_messagesLayout->insertWidget(count - 1, msgWidget);
}

void StudyView::scrollToBottom() {
    QScrollBar *sb = m_scrollArea->verticalScrollBar();
    sb->setValue(sb->maximum());
}

void StudyView::onStreamChunk(const QString &chunk) {
    m_currentResponse += chunk;
    if (m_currentAssistant) {
        m_currentAssistant->setHtml(
            QString("<div style='color: #d1d5db;'>%1</div>").arg(m_currentResponse));
        scrollToBottom();
    }
}

void StudyView::onStreamDone(const QString &fullText) {
    m_currentResponse = fullText;
    m_history.append(QJsonObject{{"role", "assistant"}, {"content", fullText}});
    m_streaming = false;
    m_input->setEnabled(true);
    m_sendBtn->setEnabled(true);
    m_statusLabel->hide();
    scrollToBottom();
}

void StudyView::onStreamError(const QString &error) {
    m_streaming = false;
    m_input->setEnabled(true);
    m_sendBtn->setEnabled(true);
    m_statusLabel->setText("Error: " + error);
    m_statusLabel->setStyleSheet("color: #ef4444; font-size: 11px;");
    m_statusLabel->show();
}
