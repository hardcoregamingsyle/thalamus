// Thalamus AI — AuthDialog.h
#pragma once

#include <QDialog>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QStackedWidget>

class ConvexClient;

class AuthDialog : public QDialog
{
    Q_OBJECT

public:
    explicit AuthDialog(ConvexClient *client, QWidget *parent = nullptr);
    bool isAuthenticated() const;

signals:
    void authenticated();

private slots:
    void onSendOtp();
    void onVerifyOtp();
    void onOtpSent(bool success, const QString &error);
    void onOtpVerified(bool success, const QString &error);

private:
    void setupUi();
    ConvexClient *m_client;
    QStackedWidget *m_stack;
    QWidget *m_emailPage;
    QLineEdit *m_emailInput;
    QPushButton *m_sendOtpButton;
    QLabel *m_emailError;
    QWidget *m_otpPage;
    QLabel *m_otpLabel;
    QLineEdit *m_otpInput;
    QPushButton *m_verifyButton;
    QLabel *m_otpError;
    QPushButton *m_backButton;
    QString m_email;
    bool m_authenticated;
};
