#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSystemTrayIcon>
#include <QMenu>
#include <QAction>
#include <QTabWidget>
#include <QVBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QCloseEvent>

class ConvexClient;
class VMBridgeManager;
class ChatView;
class ResearchView;
class StudyView;
class CodeModeView;
class VMSandboxView;
class Settings;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

    void handleUri(const QString &uri);

protected:
    void closeEvent(QCloseEvent *event) override;

private slots:
    void onTrayActivated(QSystemTrayIcon::ActivationReason reason);
    void onSettingsRequested();
    void onAbout();
    void onNewChat();
    void onBridgeConnected();
    void onBridgeDisconnected();

private:
    void setupUi();
    void setupSystemTray();
    void setupMenuBar();

    QTabWidget *m_tabs;
    QSystemTrayIcon *m_trayIcon;
    QMenu *m_trayMenu;

    ConvexClient *m_convexClient;
    VMBridgeManager *m_bridgeManager;

    ChatView *m_chatView;
    ResearchView *m_researchView;
    StudyView *m_studyView;
    CodeModeView *m_codeModeView;
    VMSandboxView *m_vmSandboxView;

    QAction *m_trayShowAction;
    QAction *m_bridgeStatusAction;
};

#endif // MAINWINDOW_H
