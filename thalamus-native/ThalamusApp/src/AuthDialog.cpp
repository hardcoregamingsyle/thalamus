#include "AuthDialog.h"
#include <QMessageBox>
#include <QGraphicsDropShadowEffect>
#include <QTimer>

AuthDialog::AuthDialog(ConvexClient *client, QWidget *parent)
    : QDialog(parent)
    , m_client(client)
    , m_authenticated(false)
{
    setupUI();

    // Connect auth signals
    connect(m_client, &ConvexClient::authCodeSent, this, &AuthDialog::onCodeSent);
    connect(m_client, &ConvexClient::authVerified, this, &AuthDialog::onAuthVerified);
}

AuthDialog::~AuthDialog() {}

void AuthDialog::setupUI()
{
    setWindowTitle("Thalamus AI — Sign In");
    setFixedSize(420, 520);
    setWindowFlags(Qt::Dialog | Qt::FramelessWindowHint);
    setAttribute(Qt::WA_TranslucentBackground);

    // Main layout
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    // Background container
    auto *container = new QWidget(this);
    container->setObjectName("authContainer");
    container->setStyleSheet(
        "#authContainer {"
        "  background: #0d0d0d;"
        "  border: 1px solid #2a2a2a;"
        "  border-radius: 16px;"
        "}"
    );

    auto *layout = new QVBoxLayout(container);
    layout->setContentsMargins(32, 40, 32, 40);
    layout->setSpacing(8);

    // Close button
    auto *closeBtn = new QPushButton("✕", container);
    closeBtn->setFixedSize(28, 28);
    closeBtn->setCursor(Qt::PointingHandCursor);
    closeBtn->setStyleSheet(
        "QPushButton { background: transparent; color: #666; border: none; font-size: 16px; }"
        "QPushButton:hover { color: #fff; background: #ff4444; border-radius: 14px; }"
    );
    connect(closeBtn, &QPushButton::clicked, this, &QDialog::reject);

    auto *closeLayout = new QHBoxLayout();
    closeLayout->addStretch();
    closeLayout->addWidget(closeBtn);
    layout->addLayout(closeLayout);

    // Logo / Brand
    auto *logoLabel = new QLabel("◆", container);
    logoLabel->setAlignment(Qt::AlignCenter);
    logoLabel->setStyleSheet("font-size: 48px; color: #a78bfa;");
    layout->addWidget(logoLabel);

    auto *brandLabel = new QLabel("Thalamus AI", container);
    brandLabel->setAlignment(Qt::AlignCenter);
    brandLabel->setStyleSheet("font-size: 24px; font-weight: 700; color: #fff; margin-bottom: 4px;");
    layout->addWidget(brandLabel);

    auto *subtitleLabel = new QLabel("Sign in to continue", container);
    subtitleLabel->setAlignment(Qt::AlignCenter);
    subtitleLabel->setStyleSheet("font-size: 13px; color: #888; margin-bottom: 20px;");
    layout->addWidget(subtitleLabel);

    // Stacked widget for two-step flow
    m_stack = new QStackedWidget(container);
    layout->addWidget(m_stack);

    // ── Step 1: Email ──────────────────────────────────────────────────────
    m_step1Page = new QWidget();
    auto *step1Layout = new QVBoxLayout(m_step1Page);
    step1Layout->setSpacing(12);

    m_step1Title = new QLabel("Email Address");
    m_step1Title->setStyleSheet("font-size: 12px; font-weight: 600; color: #ccc;");

    m_emailInput = new QLineEdit();
    m_emailInput->setPlaceholderText("you@example.com");
    m_emailInput->setStyleSheet(
        "QLineEdit {"
        "  background: #1a1a1a; border: 1px solid #333; border-radius: 8px;"
        "  padding: 12px 16px; font-size: 14px; color: #fff;"
        "}"
        "QLineEdit:focus { border-color: #a78bfa; }"
    );

    m_step1Error = new QLabel();
    m_step1Error->setStyleSheet("font-size: 11px; color: #ff6b6b;");
    m_step1Error->setVisible(false);

    m_sendCodeBtn = new QPushButton("Send Verification Code");
    m_sendCodeBtn->setCursor(Qt::PointingHandCursor);
    m_sendCodeBtn->setStyleSheet(
        "QPushButton {"
        "  background: #a78bfa; color: #fff; border: none; border-radius: 8px;"
        "  padding: 12px; font-size: 14px; font-weight: 600;"
        "}"
        "QPushButton:hover { background: #8b6ff0; }"
        "QPushButton:disabled { background: #333; color: #666; }"
    );

    step1Layout->addWidget(m_step1Title);
    step1Layout->addWidget(m_emailInput);
    step1Layout->addWidget(m_step1Error);
    step1Layout->addWidget(m_sendCodeBtn);
    step1Layout->addStretch();

    // ── Step 2: OTP ────────────────────────────────────────────────────────
    m_step2Page = new QWidget();
    auto *step2Layout = new QVBoxLayout(m_step2Page);
    step2Layout->setSpacing(12);

    m_step2Title = new QLabel("Check Your Email");
    m_step2Title->setStyleSheet("font-size: 14px; font-weight: 600; color: #fff;");

    m_step2Desc = new QLabel("Enter the 6-digit code sent to your email");
    m_step2Desc->setStyleSheet("font-size: 12px; color: #888;");
    m_step2Desc->setWordWrap(true);

    m_codeInput = new QLineEdit();
    m_codeInput->setPlaceholderText("000000");
    m_codeInput->setMaxLength(6);
    m_codeInput->setStyleSheet(
        "QLineEdit {"
        "  background: #1a1a1a; border: 1px solid #333; border-radius: 8px;"
        "  padding: 12px 16px; font-size: 18px; color: #fff;"
        "  letter-spacing: 6px; font-weight: 700;"
        "}"
        "QLineEdit:focus { border-color: #a78bfa; }"
    );

    m_step2Error = new QLabel();
    m_step2Error->setStyleSheet("font-size: 11px; color: #ff6b6b;");
    m_step2Error->setVisible(false);

    m_verifyBtn = new QPushButton("Verify & Sign In");
    m_verifyBtn->setCursor(Qt::PointingHandCursor);
    m_verifyBtn->setStyleSheet(
        "QPushButton {"
        "  background: #a78bfa; color: #fff; border: none; border-radius: 8px;"
        "  padding: 12px; font-size: 14px; font-weight: 600;"
        "}"
        "QPushButton:hover { background: #8b6ff0; }"
        "QPushButton:disabled { background: #333; color: #666; }"
    );

    m_resendBtn = new QPushButton("Resend Code");
    m_resendBtn->setCursor(Qt::PointingHandCursor);
    m_resendBtn->setStyleSheet(
        "QPushButton {"
        "  background: transparent; color: #a78bfa; border: none;"
        "  font-size: 12px; text-decoration: underline;"
        "}"
        "QPushButton:hover { color: #8b6ff0; }"
    );

    auto *backBtn = new QPushButton("← Back");
    backBtn->setCursor(Qt::PointingHandCursor);
    backBtn->setStyleSheet(
        "QPushButton { background: transparent; color: #888; border: none; font-size: 12px; }"
        "QPushButton:hover { color: #ccc; }"
    );

    step2Layout->addWidget(m_step2Title);
    step2Layout->addWidget(m_step2Desc);
    step2Layout->addSpacing(8);
    step2Layout->addWidget(m_codeInput);
    step2Layout->addWidget(m_step2Error);
    step2Layout->addWidget(m_verifyBtn);
    step2Layout->addWidget(m_resendBtn);
    step2Layout->addStretch();

    auto *backLayout = new QHBoxLayout();
    backLayout->addWidget(backBtn);
    backLayout->addStretch();
    step2Layout->addLayout(backLayout);

    // Add pages to stack
    m_stack->addWidget(m_step1Page);
    m_stack->addWidget(m_step2Page);
    showStep(1);

    layout->addStretch();
    mainLayout->addWidget(container);

    // ── Connections ────────────────────────────────────────────────────────
    connect(m_sendCodeBtn, &QPushButton::clicked, this, &AuthDialog::onSendCode);
    connect(m_verifyBtn, &QPushButton::clicked, this, &AuthDialog::onVerifyCode);
    connect(m_resendBtn, &QPushButton::clicked, this, &AuthDialog::onResendCode);
    connect(backBtn, &QPushButton::clicked, this, [this]() { showStep(1); });

    // Allow Enter key to trigger actions
    connect(m_emailInput, &QLineEdit::returnPressed, this, &AuthDialog::onSendCode);
    connect(m_codeInput, &QLineEdit::returnPressed, this, &AuthDialog::onVerifyCode);
}

void AuthDialog::showStep(int step)
{
    m_stack->setCurrentIndex(step - 1);
    if (step == 1) {
        m_emailInput->setFocus();
    } else {
        m_codeInput->setFocus();
    }
}

void AuthDialog::setLoading(bool loading)
{
    m_sendCodeBtn->setEnabled(!loading);
    m_verifyBtn->setEnabled(!loading);
    m_emailInput->setEnabled(!loading);
    m_codeInput->setEnabled(!loading);

    if (loading) {
        m_sendCodeBtn->setText("Sending...");
        m_verifyBtn->setText("Verifying...");
    } else {
        m_sendCodeBtn->setText("Send Verification Code");
        m_verifyBtn->setText("Verify & Sign In");
    }
}

void AuthDialog::onSendCode()
{
    m_email = m_emailInput->text().trimmed();
    if (m_email.isEmpty() || !m_email.contains('@')) {
        m_step1Error->setText("Please enter a valid email address");
        m_step1Error->setVisible(true);
        return;
    }
    m_step1Error->setVisible(false);
    setLoading(true);
    m_step2Desc->setText("Enter the 6-digit code sent to\n" + m_email);
    m_client->sendAuthCode(m_email);
}

void AuthDialog::onResendCode()
{
    setLoading(true);
    m_client->sendAuthCode(m_email);
}

void AuthDialog::onCodeSent(bool success, const QString &error)
{
    setLoading(false);
    if (success) {
        showStep(2);
    } else {
        m_step1Error->setText(error.isEmpty() ? "Failed to send code. Try again." : error);
        m_step1Error->setVisible(true);
    }
}

void AuthDialog::onVerifyCode()
{
    QString code = m_codeInput->text().trimmed();
    if (code.length() < 4) {
        m_step2Error->setText("Please enter the complete verification code");
        m_step2Error->setVisible(true);
        return;
    }
    m_step2Error->setVisible(false);
    setLoading(true);
    m_client->verifyAuthCode(m_email, code);
}

void AuthDialog::onAuthVerified(bool success, const QString &error)
{
    setLoading(false);
    if (success) {
        m_authenticated = true;
        // Fetch the user info / store token
        m_client->fetchCurrentUser();
        accept();
    } else {
        m_step2Error->setText(error.isEmpty() ? "Invalid code. Please try again." : error);
        m_step2Error->setVisible(true);
    }
}
