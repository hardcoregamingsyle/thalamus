// Thalamus AI — NotificationManager.cpp
#include "NotificationManager.h"

NotificationManager::NotificationManager(QSystemTrayIcon *trayIcon, QObject *parent)
    : QObject(parent), m_trayIcon(trayIcon) {}

void NotificationManager::showInfo(const QString &title, const QString &msg, int ms) {
    if (m_trayIcon && m_trayIcon->isVisible())
        m_trayIcon->showMessage(title, msg, QSystemTrayIcon::Information, ms);
}
void NotificationManager::showWarning(const QString &title, const QString &msg, int ms) {
    if (m_trayIcon && m_trayIcon->isVisible())
        m_trayIcon->showMessage(title, msg, QSystemTrayIcon::Warning, ms);
}
void NotificationManager::showError(const QString &title, const QString &msg, int ms) {
    if (m_trayIcon && m_trayIcon->isVisible())
        m_trayIcon->showMessage(title, msg, QSystemTrayIcon::Critical, ms);
}
void NotificationManager::showUpdateAvailable(const QString &v) { showInfo("Update Available", QString("Thalamus AI %1 ready.").arg(v)); }
void NotificationManager::showVmBooted() { showInfo("VM Ready", "Your virtual machine has booted."); }
void NotificationManager::showVmStopped() { showInfo("VM Stopped", "Virtual machine shut down."); }
void NotificationManager::showAuthSuccess() { showInfo("Welcome", "Signed in to Thalamus AI."); }
