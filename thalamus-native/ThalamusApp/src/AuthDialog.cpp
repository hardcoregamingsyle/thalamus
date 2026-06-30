/**
 * Thalamus AI — Email OTP Authentication Dialog
 * Two-step flow: enter email → receive OTP → verify.
 */

#include "AuthDialog.h"
#include "ConvexClient.h"

#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QStackedWidget>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QMessageBox>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>

AuthDialog::AuthDialog(ConvexClient *client, QWidget *parent)
    : QDialog(parent)
    , m_client(client)
    , m_stack(new QStackedWidget(this))
    , m_emailEdit(new QLineEdit(this))
    , m_otpEdit(new QLineEdit(this))
    , m_sendBtn(new QPushButton("Send Code", this))
    , m_verifyBtn(new QPushButton("Verify", this))
    , m_statusLabel(new QLabel(this))
    , m_titleLabel(new QLabel("Thalamus AI", this))
{
    setWindowTitle("Sign In");
    setFixedSize(380, 320);
    setupUi();
}

void AuthDialog::setupUi() {
    auto *layout = new QVBoxLayout(this);
    layout->setSpacing(12);
    layout->setContentsMargins(32, 24, 32, 24);

    // Title
    m_titleLabel->setAlignment(Qt::AlignCenter);
    QFont titleFont;
    titleFont.setPointSize(18);
    titleFont.setBold(true);
    m_titleLabel->setFont(titleFont);
    m_titleLabel->setStyleSheet("color: #e5e7eb;");
    layout->addWidget(m_titleLabel);

    // Subtitle
    auto *subtitle = new QLabel("Sign in with your email", this);
    subtitle->setAlignment(Qt::AlignCenter);
    subtitle->setStyleSheet("color: #9ca3af; font-size: 12px;");
    layout->addWidget(subtitle);

    layout->addSpacing(16);

    // Step 1: Email
    auto *emailPage = new QWidget();
    auto *emailLayout = new QVBoxLayout(emailPage);
    emailLayout->setContentsMargins(0, 0, 0, 0);
    emailLayout->setSpacing(10);

    m_emailEdit->setPlaceholderText("you@example.com");
    m_emailEdit->setStyleSheet(
        "QLineEdit { padding: 10px 14px; border: 1px solid #374151; border-radius: 8px; "
        "background: #111827; color: #e5e7eb; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6366f1; }");
    emailLayout->addWidget(m_emailEdit);

    m_sendBtn->setStyleSheet(
        "QPushButton { padding: 10px; background: #6366f1; color: white; border: none; "
        "border-radius: 8px; font-weight: bold; font-size: 14px; }"
        "QPushButton:hover { background: #818cf8; }");
    emailLayout->addWidget(m_sendBtn);

    // Step 2: OTP
    auto *otpPage = new QWidget();
    auto *otpLayout = new QVBoxLayout(otpPage);
    otpLayout->setContentsMargins(0, 0, 0, 0);
    otpLayout->setSpacing(10);

    auto *otpHint = new QLabel("Enter the 6-digit code sent to your email", otpPage);
    otpHint->setAlignment(Qt::AlignCenter);
    otpHint->setStyleSheet("color: #9ca3af; font-size: 12px;");
    otpLayout->addWidget(otpHint);

    m_otpEdit->setPlaceholderText("000000");
    m_otpEdit->setMaxLength(6);
    m_otpEdit->setStyleSheet(
        "QLineEdit { padding: 10px 14px; border: 1px solid #374151; border-radius: 8px; "
        "background: #111827; color: #e5e7eb; font-size: 18px; letter-spacing: 8px; }"
        "QLineEdit:focus { border-color: #6366f1; }");
    otpLayout->addWidget(m_otpEdit);

    m_verifyBtn->setStyleSheet(
        "QPushButton { padding: 10px; background: #6366f1; color: white; border: none; "
        "border-radius: 8px; font-weight: bold; font-size: 14px; }"
        "QPushButton:hover { background: #818cf8; }");
    otpLayout->addWidget(m_verifyBtn);

    m_stack->addWidget(emailPage);
    m_stack->addWidget(otpPage);
    layout->addWidget(m_stack);

    // Status
    m_statusLabel->setAlignment(Qt::AlignCenter);
    m_statusLabel->setStyleSheet("color: #ef4444; font-size: 12px;");
    layout->addWidget(m_statusLabel);

    // Connections
    connect(m_sendBtn, &QPushButton::clicked, this, &AuthDialog::onSendOtp);
    connect(m_verifyBtn, &QPushButton::clicked, this, &AuthDialog::onVerifyOtp);
    connect(m_client, &ConvexClient::authStateChanged, this, &AuthDialog::onAuthStateChanged);
}

void AuthDialog::onSendOtp() {
    QString email = m_emailEdit->text().trimmed();
    if (email.isEmpty() || !email.contains('@')) {
        m_statusLabel->setText("Please enter a valid email address");
        return;
    }
    m_sendBtn->setEnabled(false);
    m_sendBtn->setText("Sending...");
    m_statusLabel->setText("");

    // TODO: Call Convex emailOtp.send action via HTTP
    // For now, simulate with a timer
    QTimer::singleShot(1500, this, [this]() {
        m_stack->setCurrentIndex(1);
        m_sendBtn->setEnabled(true);
        m_sendBtn->setText("Send Code");
        m_statusLabel->setText("Code sent! Check your email.");
        m_statusLabel->setStyleSheet("color: #22c55e; font-size: 12px;");
    });
}

void AuthDialog::onVerifyOtp() {
    QString otp = m_otpEdit->text().trimmed();
    if (otp.length() != 6) {
        m_statusLabel->setText("Please enter the 6-digit code");
        return;
    }
    m_verifyBtn->setEnabled(false);
    m_verifyBtn->setText("Verifying...");
    m_statusLabel->setText("");

    // TODO: Call Convex emailOtp.verify action via HTTP
    // For now, simulate success
    QTimer::singleShot(1500, this, [this]() {
        m_verifyBtn->setEnabled(true);
        m_verifyBtn->setText("Verify");
        m_statusLabel->setText("Invalid code. Please try again.");
        m_statusLabel->setStyleSheet("color: #ef4444; font-size: 12px;");
    });
}

void AuthDialog::onAuthStateChanged(bool authenticated) {
    if (authenticated) {
        accept();
    }
}
