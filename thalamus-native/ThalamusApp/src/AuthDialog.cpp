// Thalamus AI — AuthDialog.cpp
#include "AuthDialog.h"
#include "ConvexClient.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QMessageBox>
#include <QRegularExpression>
#include <QSettings>
#include <QFont>

AuthDialog::AuthDialog(ConvexClient *client, QWidget *parent)
    : QDialog(parent)
    , m_client(client)
    , m_authenticated(false)
{
    setupUi();

    connect(m_client, &ConvexClient::otpSent, this, &AuthDialog::onOtpSent);
    connect(m_client, &ConvexClient::otpVerified, this, &AuthDialog::onOtpVerified);

    // Restore saved auth token
    QSettings settings;
    QString savedToken = settings.value("auth/token").toString();
    if (!savedToken.isEmpty()) {
        m_client->setAuthToken(savedToken);
        m_authenticated = true;
        emit authenticated();
        accept();
    }
}

bool AuthDialog::isAuthenticated() const { return m_authenticated; }

void AuthDialog::setupUi()
{
    setWindowTitle("Sign in to Thalamus AI");
    setFixedSize(420, 380);
    setModal(true);

    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setSpacing(16);
    mainLayout->setContentsMargins(32, 32, 32, 32);

    auto *titleLabel = new QLabel("Thalamus AI");
    titleLabel->setAlignment(Qt::AlignCenter);
    QFont titleFont = titleLabel->font();
    titleFont.setPointSize(22);
    titleFont.setBold(true);
    titleLabel->setFont(titleFont);
    titleLabel->setStyleSheet("color: #c0c0f0;");
    mainLayout->addWidget(titleLabel);

    auto *subtitleLabel = new QLabel("Sign in with your email");
    subtitleLabel->setAlignment(Qt::AlignCenter);
    subtitleLabel->setStyleSheet("color: #8080a0; font-size: 13px;");
    mainLayout->addWidget(subtitleLabel);
    mainLayout->addSpacing(16);

    m_stack = new QStackedWidget(this);

    // Page 1: Email input
    m_emailPage = new QWidget;
    auto *emailLayout = new QVBoxLayout(m_emailPage);
    emailLayout->setSpacing(12);

    m_emailInput = new QLineEdit;
    m_emailInput->setPlaceholderText("you@example.com");
    m_emailInput->setStyleSheet(
        "QLineEdit { padding: 10px; border: 1px solid #3e3e5e; border-radius: 6px; "
        "background: #1e1e32; color: #e0e0f0; font-size: 14px; }"
        "QLineEdit:focus { border-color: #6e6eff; }");
    emailLayout->addWidget(m_emailInput);

    m_sendOtpButton = new QPushButton("Send Verification Code");
    m_sendOtpButton->setCursor(Qt::PointingHandCursor);
    m_sendOtpButton->setStyleSheet(
        "QPushButton { padding: 10px; border: none; border-radius: 6px; "
        "background: #4a4aff; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #5a5aff; }"
        "QPushButton:disabled { background: #2a2a4a; color: #606080; }");
    connect(m_sendOtpButton, &QPushButton::clicked, this, &AuthDialog::onSendOtp);
    emailLayout->addWidget(m_sendOtpButton);

    m_emailError = new QLabel;
    m_emailError->setStyleSheet("color: #ff6b6b; font-size: 12px;");
    m_emailError->setWordWrap(true);
    m_emailError->hide();
    emailLayout->addWidget(m_emailError);

    m_stack->addWidget(m_emailPage);

    // Page 2: OTP verification
    m_otpPage = new QWidget;
    auto *otpLayout = new QVBoxLayout(m_otpPage);
    otpLayout->setSpacing(12);

    m_otpLabel = new QLabel("Enter the verification code sent to your email");
    m_otpLabel->setWordWrap(true);
    m_otpLabel->setStyleSheet("color: #a0a0c0; font-size: 13px;");
    otpLayout->addWidget(m_otpLabel);

    m_otpInput = new QLineEdit;
    m_otpInput->setPlaceholderText("000000");
    m_otpInput->setMaxLength(6);
    m_otpInput->setStyleSheet(
        "QLineEdit { padding: 10px; border: 1px solid #3e3e5e; border-radius: 6px; "
        "background: #1e1e32; color: #e0e0f0; font-size: 18px; letter-spacing: 8px; }"
        "QLineEdit:focus { border-color: #6e6eff; }");
    otpLayout->addWidget(m_otpInput);

    m_verifyButton = new QPushButton("Verify & Sign In");
    m_verifyButton->setCursor(Qt::PointingHandCursor);
    m_verifyButton->setStyleSheet(
        "QPushButton { padding: 10px; border: none; border-radius: 6px; "
        "background: #4a4aff; color: white; font-size: 14px; font-weight: bold; }"
        "QPushButton:hover { background: #5a5aff; }"
        "QPushButton:disabled { background: #2a2a4a; color: #606080; }");
    connect(m_verifyButton, &QPushButton::clicked, this, &AuthDialog::onVerifyOtp);
    otpLayout->addWidget(m_verifyButton);

    m_otpError = new QLabel;
    m_otpError->setStyleSheet("color: #ff6b6b; font-size: 12px;");
    m_otpError->setWordWrap(true);
    m_otpError->hide();
    otpLayout->addWidget(m_otpError);

    m_backButton = new QPushButton("\u2190 Back");
    m_backButton->setFlat(true);
    m_backButton->setCursor(Qt::PointingHandCursor);
    m_backButton->setStyleSheet(
        "QPushButton { color: #8080a0; font-size: 12px; border: none; }"
        "QPushButton:hover { color: #c0c0f0; }");
    connect(m_backButton, &QPushButton::clicked, this, [this]() {
        m_stack->setCurrentIndex(0);
        m_emailError->hide();
        m_otpError->hide();
    });
    otpLayout->addWidget(m_backButton);

    m_stack->addWidget(m_otpPage);
    mainLayout->addWidget(m_stack);
}

void AuthDialog::onSendOtp()
{
    m_email = m_emailInput->text().trimmed();
    QRegularExpression emailRegex(R"(^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$)");
    if (!emailRegex.match(m_email).hasMatch()) {
        m_emailError->setText("Please enter a valid email address");
        m_emailError->show();
        return;
    }
    m_emailError->hide();
    m_sendOtpButton->setEnabled(false);
    m_sendOtpButton->setText("Sending...");
    m_client->sendEmailOtp(m_email);
}

void AuthDialog::onOtpSent(bool success, const QString &error)
{
    m_sendOtpButton->setEnabled(true);
    m_sendOtpButton->setText("Send Verification Code");

    if (success) {
        m_otpLabel->setText(QString("Enter the verification code sent to\n%1").arg(m_email));
        m_otpInput->clear();
        m_otpError->hide();
        m_stack->setCurrentIndex(1);
        m_otpInput->setFocus();
    } else {
        m_emailError->setText(error.isEmpty() ? "Failed to send code. Try again." : error);
        m_emailError->show();
    }
}

void AuthDialog::onVerifyOtp()
{
    QString code = m_otpInput->text().trimmed();
    if (code.length() < 4) {
        m_otpError->setText("Please enter the full verification code");
        m_otpError->show();
        return;
    }
    m_otpError->hide();
    m_verifyButton->setEnabled(false);
    m_verifyButton->setText("Verifying...");
    m_client->verifyEmailOtp(m_email, code);
}

void AuthDialog::onOtpVerified(bool success, const QString &error)
{
    m_verifyButton->setEnabled(true);
    m_verifyButton->setText("Verify & Sign In");

    if (success) {
        m_authenticated = true;
        QSettings settings;
        settings.setValue("auth/token", m_client->authToken());
        emit authenticated();
        accept();
    } else {
        m_otpError->setText(error.isEmpty() ? "Invalid or expired code. Try again." : error);
        m_otpError->show();
    }
}
