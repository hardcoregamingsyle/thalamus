#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QTabWidget>
#include <QSystemTrayIcon>
#include <QMenu>
#include <QLabel>
#include <QStatusBar>
#include <QPushButton>
#include "ConvexClient.h"
#include "ChatView.h"
#include "ResearchView.h"
#include "StudyView.h"
#include "CodeModeView.h"
#include "VMSandboxView.h"
#include "Settings.h"

/**
 * @brief Main application window for Thalamus AI desktop app.
 *
 * Provides a tabbed interface with:
 * - Chat mode
 * - Research mode
 * - Study mode (with RAG + knowledge graph)
 * - Code mode (9-agent pipeline)
 * - VM Sandbox (QEMU + VNC)
 * - Settings / Account
 */
class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

    void initialize();

signals:
    void vmBridgeStatusChanged(bool connected);

protected:
    void closeEvent(QCloseEvent *event) override;
    void changeEvent(QEvent *event) override;

private slots:
    void onAuthResult(bool success);
    void onTabChanged(int index);
    void onVmBridgeConnected();
    void onVmBridgeDisconnected();
    void onVmBridgeMessage(const QJsonObject &msg);
    void onUserFetched(const QJsonObject &user);
    void showAboutDialog();

private:
    void setupUI();
    void setupMenuBar();
    void setupSystemTray();
    void setupStatusBar();
    void applyTheme();
    void checkAuth();
    void loadSettings();
    void saveSettings();
    void updateTitleBar();

    // Core
    ConvexClient *m_client;

    // UI
    QTabWidget *m_tabWidget;
    ChatView *m_chatView;
    ResearchView *m_researchView;
    StudyView *m_studyView;
    CodeModeView *m_codeView;
    VMSandboxView *m_vmView;
    Settings *m_settingsPage;

    // Status bar
    QLabel *m_statusLabel;
    QLabel *m_bridgeStatus;
    QLabel *m_userLabel;

    // System tray
    QSystemTrayIcon *m_trayIcon;
    QMenu *m_trayMenu;

    // Auth state
    bool m_authenticated;
    QString m_userId;
    QString m_userName;
};

#endif // MAINWINDOW_H
