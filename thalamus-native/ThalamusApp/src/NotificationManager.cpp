#include "NotificationManager.h"
#include <QApplication>
#include <QStyle>

NotificationManager::NotificationManager(QObject *parent)
    : QObject(parent)
    , m_trayIcon(nullptr)
{
}

NotificationManager::~NotificationManager() {}

void NotificationManager::show(const QString &title, const QString &message,
                                Priority priority, int durationMs)
{
    m_lastTitle = title;
    m_lastMessage = message;

    // Use system tray for notifications
    if (m_trayIcon && m_trayIcon->isVisible()) {
        QSystemTrayIcon::MessageIcon icon = QSystemTrayIcon::Information;
        switch (priority) {
            case Low: icon = QSystemTrayIcon::NoIcon; break;
            case Normal: icon = QSystemTrayIcon::Information; break;
            case High: icon = QSystemTrayIcon::Warning; break;
            case Critical: icon = QSystemTrayIcon::Critical; break;
        }

        m_trayIcon->showMessage(title, message, icon, durationMs);
    } else {
        // Fallback: print to debug
        qDebug() << "[Notification]" << title << ":" << message;
    }
}

void NotificationManager::showVMNotification(const QString &vmName, const QString &status)
{
    QString title = "VM Sandbox";
    QString message;

    if (status == "booted") {
        message = vmName + " has booted successfully. VNC display is ready.";
        show(title, message, Normal);
    } else if (status == "stopped") {
        message = vmName + " has been stopped.";
        show(title, message, Low);
    } else if (status == "error") {
        message = "Failed to boot " + vmName + ". Check the bridge connection.";
        show(title, message, High);
    }
}

void NotificationManager::showUpdateNotification(const QString &newVersion)
{
    show("Update Available",
         "Thalamus AI v" + newVersion + " is now available.",
         High, 10000);
}

void NotificationManager::showError(const QString &title, const QString &message)
{
    show(title, message, Critical, 8000);
}

void NotificationManager::onMessageClicked()
{
    emit notificationClicked(m_lastTitle, m_lastMessage);
}
