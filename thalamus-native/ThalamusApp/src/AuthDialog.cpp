// Thalamus AI — AuthDialog.cpp
#include "AuthDialog.h"
#include "ConvexClient.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QRegularExpression>
#include <QSettings>
#include <QFont>

AuthDialog::AuthDialog(ConvexClient *client, QWidget *parent)
    : QDialog(parent), m_client(client), m_authenticated(false)
{
    setupUi();
    connect(m_client, &ConvexClient::otpSent, this, &AuthDialog::onOtpSent);
    connect(m_client, &ConvexClient::otpVerified, this, &AuthDialog::onOtpVerified);
    QSettings s;
    QString savedToken = s.value("auth/token").toString();
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
    auto *ml = new QVBoxLayout(this);
    ml->setSpacing(16); ml->setContentsMargins(32, 32, 32, 32);

    auto *title = new QLabel("Thalamus AI");
    title->setAlignment(Qt::AlignCenter);
    QFont f = title->font(); f.setPointSize(22); f.setBold(true); title->setFont(f);
    title->setStyleSheet("color: #c0c0f0;");
    ml->addWidget(title);

    auto *sub = new QLabel("Sign in with your email");
    sub->setAlignment(Qt::AlignCenter);
    sub->setStyleSheet("color: #8080a0; font-size: 13px;");
    ml->addWidget(sub); ml->addSpacing(16);

    m_stack = new QStackedWidget(this);
    m_emailPage = new QWidget;
    auto *el = new QVBoxLayout(m_emailPage); el->setSpacing(12);
    m_emailInput = new QLineEdit;
    m_emailInput->setPlaceholderText("you@example.com");
    m_emailInput->setStyleSheet(
        "QLineEdit { padding:10px; border:1px solid #3e3e5e; border-radius:6px; "
        "background:#1e1e32; color:#e0e0f0; font-size:14px; }"
        "QLineEdit:focus { border-color:#6e6eff; }");
    el->addWidget(m_emailInput);
    m_sendOtpButton = new QPushButton("Send Verification Code");
    m_sendOtpButton->setCursor(Qt::PointingHandCursor);
    m_sendOtpButton->setStyleSheet(
        "QPushButton { padding:10px; border:none; border-radius:6px; "
        "background:#4a4aff; color:white; font-size:14px; font-weight:bold; }"
        "QPushButton:hover { background:#5a5aff; }"
        "QPushButton:disabled { background:#2a2a4a; color:#606080; }");
    connect(m_sendOtpButton, &QPushButton::clicked, this, &AuthDialog::onSendOtp);
    el->addWidget(m_sendOtpButton);
    m_emailError = new QLabel;
    m_emailError->setStyleSheet("color:#ff6b6b; font-size:12px;");
    m_emailError->setWordWrap(true); m_emailError->hide();
    el->addWidget(m_emailError);
    m_stack->addWidget(m_emailPage);

    m_otpPage = new QWidget;
    auto *ol = new QVBoxLayout(m_otpPage); ol->setSpacing(12);
    m_otpLabel = new QLabel("Enter the verification code sent to your email");
    m_otpLabel->setWordWrap(true);
    m_otpLabel->setStyleSheet("color:#a0a0c0; font-size:13px;");
    ol->addWidget(m_otpLabel);
    m_otpInput = new QLineEdit;
    m_otpInput->setPlaceholderText("000000"); m_otpInput->setMaxLength(6);
    m_otpInput->setStyleSheet(
        "QLineEdit { padding:10px; border:1px solid #3e3e5e; border-radius:6px; "
        "background:#1e1e32; color:#e0e0f0; font-size:18px; letter-spacing:8px; }"
        "QLineEdit:focus { border-color:#6e6eff; }");
    ol->addWidget(m_otpInput);
    m_verifyButton = new QPushButton("Verify & Sign In");
    m_verifyButton->setCursor(Qt::PointingHandCursor);
    m_verifyButton->setStyleSheet(m_sendOtpButton->styleSheet());
    connect(m_verifyButton, &QPushButton::clicked, this, &AuthDialog::onVerifyOtp);
    ol->addWidget(m_verifyButton);
    m_otpError = new QLabel;
    m_otpError->setStyleSheet("color:#ff6b6b; font-size:12px;");
    m_otpError->setWordWrap(true); m_otpError->hide();
    ol->addWidget(m_otpError);
    m_backButton = new QPushButton("\u2190 Back");
    m_backButton->setFlat(true); m_backButton->setCursor(Qt::PointingHandCursor);
    m_backButton->setStyleSheet("QPushButton { color:#8080a0; font-size:12px; border:none; }"
        "QPushButton:hover { color:#c0c0f0; }");
    connect(m_backButton, &QPushButton::clicked, this, [this]() {
        m_stack->setCurrentIndex(0); m_emailError->hide(); m_otpError->hide();
    });
    ol->addWidget(m_backButton);
    m_stack->addWidget(m_otpPage);
    ml->addWidget(m_stack);
}

void AuthDialog::onSendOtp()
{
    m_email = m_emailInput->text().trimmed();
    QRegularExpression re(R"(^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$)");
    if (!re.match(m_email).hasMatch()) {
        m_emailError->setText("Please enter a valid email address"); m_emailError->show(); return;
    }
    m_emailError->hide(); m_sendOtpButton->setEnabled(false); m_sendOtpButton->setText("Sending...");
    m_client->sendEmailOtp(m_email);
}

void AuthDialog::onOtpSent(bool success, const QString &error)
{
    m_sendOtpButton->setEnabled(true); m_sendOtpButton->setText("Send Verification Code");
    if (success) {
        m_otpLabel->setText(QString("Enter the verification code sent to\n%1").arg(m_email));
        m_otpInput->clear(); m_otpError->hide(); m_stack->setCurrentIndex(1); m_otpInput->setFocus();
    } else {
        m_emailError->setText(error.isEmpty() ? "Failed to send code." : error); m_emailError->show();
    }
}

void AuthDialog::onVerifyOtp()
{
    QString code = m_otpInput->text().trimmed();
    if (code.length() < 4) {
        m_otpError->setText("Enter the full code"); m_otpError->show(); return;
    }
    m_otpError->hide(); m_verifyButton->setEnabled(false); m_verifyButton->setText("Verifying...");
    m_client->verifyEmailOtp(m_email, code);
}

void AuthDialog::onOtpVerified(bool success, const QString &error)
{
    m_verifyButton->setEnabled(true); m_verifyButton->setText("Verify & Sign In");
    if (success) {
        m_authenticated = true;
        QSettings s; s.setValue("auth/token", m_client->authToken());
        emit authenticated(); accept();
    } else {
        m_otpError->setText(error.isEmpty() ? "Invalid or expired code." : error); m_otpError->show();
    }
}
