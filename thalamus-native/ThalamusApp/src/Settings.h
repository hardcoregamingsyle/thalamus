// Thalamus AI — Settings.h
#pragma once

#include <QWidget>
#include <QLineEdit>
#include <QPushButton>
#include <QCheckBox>
#include <QSpinBox>
#include <QTabWidget>
#include <QLabel>

class ConvexClient;

class Settings : public QWidget
{
    Q_OBJECT

public:
    explicit Settings(ConvexClient *client, QWidget *parent = nullptr);
    ~Settings() = default;

signals:
    void settingsChanged();

private slots:
    void onSaveGeneral();
    void onSaveVm();
    void onCheckForUpdates();
    void onSignOut();

private:
    void setupUi();
    void loadSettings();

    ConvexClient *m_client;
    QTabWidget *m_tabWidget;

    // General tab
    QLineEdit *m_convexUrlInput;
    QLabel *m_authStatusLabel;
    QPushButton *m_signOutButton;

    // VM tab
    QSpinBox *m_vncPortSpinBox;
    QLineEdit *m_qemuPathInput;
    QSpinBox *m_defaultRamSpinBox;
    QSpinBox *m_defaultCpuSpinBox;

    // Updates tab
    QLabel *m_versionLabel;
    QPushButton *m_checkUpdatesButton;
};
