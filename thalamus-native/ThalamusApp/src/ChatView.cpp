#include "ChatView.h"
ChatView::ChatView(QWidget *parent) : QWidget(parent) {
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(12, 12, 12, 12);
    auto *header = new QLabel("AI Chat");
    header->setStyleSheet("font-size: 20px; font-weight: bold; color: #DCDCE1; padding: 8px 0;");
    m_display = new QTextEdit;
    m_display->setReadOnly(true);
    m_display->setStyleSheet("QTextEdit { background: #121218; color: #DCDCE1; border: 1px solid #2A2A35; border-radius: 8px; padding: 12px; font-size: 13px; }");
    m_input = new QLineEdit;
    m_input->setPlaceholderText("Type a message...");
    m_input->setStyleSheet("QLineEdit { background: #121218; color: #DCDCE1; border: 1px solid #2A2A35; border-radius: 8px; padding: 10px 14px; font-size: 13px; } QLineEdit:focus { border-color: #4A6CFF; }");
    m_sendBtn = new QPushButton("Send");
    m_sendBtn->setStyleSheet("QPushButton { background: #4A6CFF; color: white; border: none; border-radius: 8px; padding: 10px 24px; font-weight: bold; } QPushButton:hover { background: #5B7DFF; }");
    auto *inputRow = new QHBoxLayout;
    inputRow->addWidget(m_input, 1);
    inputRow->addWidget(m_sendBtn);
    layout->addWidget(header);
    layout->addWidget(m_display, 1);
    layout->addLayout(inputRow);
}
