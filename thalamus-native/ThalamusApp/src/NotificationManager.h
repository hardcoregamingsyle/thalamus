// Thalamus AI — NotificationManager.h
#pragma once

#include <QObject>
#include <QSystemTrayIcon>

class NotificationManager : public QObject
{
    Q_OBJECT

public:
    explicit NotificationManager(QSystemTrayIcon *trayIcon, QObject *parent = nullptr);
    ~NotificationManager() = default;

    void showInfo(const QString &title, const QString &message, int durationMs = 3000);
    void showWarning(const QString &title, const QString &message, int durationMs = 5000);
    void showError(const QString &title, const QString &message, int durationMs = 5000);

    void showUpdateAvailable(const QString &version);
    void showVmBooted();
    void showVmStopped();
    void showAuthSuccess();

private:
    QSystemTrayIcon *m_trayIcon;
};
