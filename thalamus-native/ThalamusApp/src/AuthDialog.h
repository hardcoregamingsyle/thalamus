#ifndef AUTHDIALOG_H
#define AUTHDIALOG_H

#include <QDialog>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QStackedWidget>

class ConvexClient;

class AuthDialog : public QDialog {
    Q_OBJECT

public:
    explicit AuthDialog(ConvexClient *client, QWidget *parent = nullptr);

private slots:
    void onSendOtp();
    void onVerifyOtp();
    void onAuthStateChanged(bool authenticated);

private:
    void setupUi();

    ConvexClient *m_client;
    QStackedWidget *m_stack;
    QLineEdit *m_emailEdit;
    QLineEdit *m_otpEdit;
    QPushButton *m_sendBtn;
    QPushButton *m_verifyBtn;
    QLabel *m_statusLabel;
    QLabel *m_titleLabel;
};

#endif // AUTHDIALOG_H
