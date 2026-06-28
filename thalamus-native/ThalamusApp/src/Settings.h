#ifndef SETTINGS_H
#define SETTINGS_H

#include <QWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QComboBox>
#include <QTabWidget>
#include <QCheckBox>
#include <QSpinBox>
#include <QGroupBox>
#include "ConvexClient.h"

/**
 * @brief Settings page — account, API keys, VM bridge, appearance, and about.
 */
class Settings : public QWidget
{
    Q_OBJECT

public:
    explicit Settings(ConvexClient *client, QWidget *parent = nullptr);
    ~Settings();

signals:
    void convexUrlChanged(const QString &url);

private slots:
    void onSaveGeneral();
    void onSaveVM();
    void onSignOut();
    void onCheckForUpdates();

private:
    void setupUI();
    void loadSettings();
    void saveSettings();

    ConvexClient *m_client;

    QTabWidget *m_tabWidget;

    // General tab
    QLineEdit *m_convexUrlInput;
    QLineEdit *m_siteUrlInput;
    QCheckBox *m_startMinimized;
    QCheckBox *m_trayIconCheck;
    QCheckBox *m_autoConnectBridge;
    QComboBox *m_themeCombo;

    // VM tab
    QSpinBox *m_defaultRam;
    QSpinBox *m_defaultCores;
    QLineEdit *m_qemuPath;
    QLineEdit *m_bridgePath;
    QLineEdit *m_vmDataDir;

    // Account tab
    QLabel *m_userEmail;
    QLabel *m_userName;
    QPushButton *m_signOutBtn;

    // About tab
    QLabel *m_versionLabel;
    QPushButton *m_updateBtn;
};

#endif // SETTINGS_H
