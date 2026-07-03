#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QStackedWidget>
#include <QListWidget>
#include <QLabel>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QSplitter>
#include <QPushButton>
#include <QSystemTrayIcon>
#include <QMenu>
#include <QCloseEvent>

class ConvexClient;
class AuthDialog;
class ChatView;
class ResearchView;
class StudyView;
class CodeModeView;
class VMSandboxView;
class Settings;
class AutoUpdater;
class NotificationManager;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

    void applyDarkTheme();

protected:
    void closeEvent(QCloseEvent *event) override;

private slots:
    void onNavigate(int index);
    void showAuthDialog();
    void onAuthSuccess(const QString &token);
    void updateStatusBar(const QString &message);

private:
    void setupUI();
    void setupTrayIcon();
    void createViews();
    void setupConnections();

    // Navigation
    QListWidget *m_navList;
    QStackedWidget *m_contentStack;

    // Views
    ChatView *m_chatView;
    ResearchView *m_researchView;
    StudyView *m_studyView;
    CodeModeView *m_codeView;
    VMSandboxView *m_vmView;
    Settings *m_settingsView;

    // Infrastructure
    ConvexClient *m_convexClient;
    AutoUpdater *m_updater;
    NotificationManager *m_notifier;
    QSystemTrayIcon *m_trayIcon;
    QLabel *m_statusLabel;

    // State
    QString m_authToken;
    bool m_authenticated;
};

#endif // MAINWINDOW_H
