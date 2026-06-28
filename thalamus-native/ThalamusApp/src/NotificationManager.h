#ifndef NOTIFICATIONMANAGER_H
#define NOTIFICATIONMANAGER_H

#include <QObject>
#include <QSystemTrayIcon>
#include <QString>

/**
 * @brief Manages desktop toast / tray notifications.
 *
 * Shows non-intrusive notifications for:
 * - VM boot complete
 * - Bridge status changes
 * - Agent pipeline events
 * - Update availability
 * - Errors
 */
class NotificationManager : public QObject
{
    Q_OBJECT

public:
    explicit NotificationManager(QObject *parent = nullptr);
    ~NotificationManager();

    enum Priority { Low, Normal, High, Critical };

    /// Show a notification
    void show(const QString &title, const QString &message,
              Priority priority = Normal, int durationMs = 5000);

    /// Show VM notification
    void showVMNotification(const QString &vmName, const QString &status);

    /// Show update notification
    void showUpdateNotification(const QString &newVersion);

    /// Show error notification
    void showError(const QString &title, const QString &message);

    /// Set the tray icon for notifications
    void setTrayIcon(QSystemTrayIcon *icon) { m_trayIcon = icon; }

signals:
    void notificationClicked(const QString &title, const QString &message);

private slots:
    void onMessageClicked();

private:
    QSystemTrayIcon *m_trayIcon;
    QString m_lastTitle;
    QString m_lastMessage;
};

#endif // NOTIFICATIONMANAGER_H
