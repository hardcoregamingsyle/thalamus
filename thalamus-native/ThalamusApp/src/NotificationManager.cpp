// Thalamus AI — NotificationManager.cpp
#include "NotificationManager.h"

NotificationManager::NotificationManager(QSystemTrayIcon *trayIcon, QObject *parent)
    : QObject(parent)
    , m_trayIcon(trayIcon)
{}

void NotificationManager::showInfo(const QString &title, const QString &message, int durationMs)
{
    if (m_trayIcon && m_trayIcon->isVisible())
        m_trayIcon->showMessage(title, message,
            QSystemTrayIcon::Information, durationMs);
}

void NotificationManager::showWarning(const QString &title, const QString &message, int durationMs)
{
    if (m_trayIcon && m_trayIcon->isVisible())
        m_trayIcon->showMessage(title, message,
            QSystemTrayIcon::Warning, durationMs);
}

void NotificationManager::showError(const QString &title, const QString &message, int durationMs)
{
    if (m_trayIcon && m_trayIcon->isVisible())
        m_trayIcon->showMessage(title, message,
            QSystemTrayIcon::Critical, durationMs);
}

void NotificationManager::showUpdateAvailable(const QString &version)
{
    showInfo("Update Available",
        QString("Thalamus AI %1 is ready to install.").arg(version), 5000);
}

void NotificationManager::showVmBooted()
{
    showInfo("VM Ready", "Your virtual machine has booted and is ready.", 3000);
}

void NotificationManager::showVmStopped()
{
    showInfo("VM Stopped", "Your virtual machine has been shut down.", 3000);
}

void NotificationManager::showAuthSuccess()
{
    showInfo("Welcome", "You are now signed in to Thalamus AI.", 3000);
}
