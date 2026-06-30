// Thalamus AI — MainWindow.h
#pragma once

#include <QMainWindow>
#include <QTabWidget>
#include <QSystemTrayIcon>
#include <QMenu>
#include <QCloseEvent>

class ChatView;
class ResearchView;
class StudyView;
class CodeModeView;
class VMSandboxView;
class Settings;
class ConvexClient;

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow();
    void handleUri(const QString &uri);

protected:
    void closeEvent(QCloseEvent *event) override;

private slots:
    void onTabChanged(int index);
    void onTrayActivated(QSystemTrayIcon::ActivationReason reason);

private:
    void setupUi();
    void setupTrayIcon();
    void saveSettings();
    void restoreSettings();

    QTabWidget *m_tabWidget;
    ChatView *m_chatView;
    ResearchView *m_researchView;
    StudyView *m_studyView;
    CodeModeView *m_codeModeView;
    VMSandboxView *m_vmSandboxView;
    Settings *m_settingsView;
    QSystemTrayIcon *m_trayIcon;
    QMenu *m_trayMenu;
    QAction *m_showAction;
    QAction *m_quitAction;
    ConvexClient *m_convexClient;
};
