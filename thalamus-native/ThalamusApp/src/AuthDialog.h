#ifndef AUTHDIALOG_H
#define AUTHDIALOG_H

#include <QDialog>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QStackedWidget>
#include <QVBoxLayout>
#include "ConvexClient.h"

/**
 * @brief Email OTP authentication dialog for Thalamus AI.
 *
 * Two-step flow:
 * 1. Enter email → send OTP
 * 2. Enter OTP code → verify → authenticated
 */
class AuthDialog : public QDialog
{
    Q_OBJECT

public:
    explicit AuthDialog(ConvexClient *client, QWidget *parent = nullptr);
    ~AuthDialog();

    QString authToken() const { return m_authToken; }
    bool isAuthenticated() const { return m_authenticated; }

signals:
    void authenticationComplete(bool success);

private slots:
    void onSendCode();
    void onVerifyCode();
    void onCodeSent(bool success, const QString &error);
    void onAuthVerified(bool success, const QString &error);
    void onResendCode();

private:
    void setupUI();
    void showStep(int step);
    void setLoading(bool loading);

    ConvexClient *m_client;

    // UI
    QStackedWidget *m_stack;
    QWidget *m_step1Page;
    QWidget *m_step2Page;

    // Step 1: Email entry
    QLineEdit *m_emailInput;
    QPushButton *m_sendCodeBtn;
    QLabel *m_step1Error;
    QLabel *m_step1Title;
    QLabel *m_step1Desc;

    // Step 2: OTP verification
    QLineEdit *m_codeInput;
    QPushButton *m_verifyBtn;
    QPushButton *m_resendBtn;
    QLabel *m_step2Error;
    QLabel *m_step2Title;
    QLabel *m_step2Desc;

    // State
    QString m_email;
    QString m_authToken;
    bool m_authenticated;
};

#endif // AUTHDIALOG_H
