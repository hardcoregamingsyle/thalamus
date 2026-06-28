#ifndef AUTOUPDATER_H
#define AUTOUPDATER_H

#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QString>
#include <QVersionNumber>

/**
 * @brief Checks for new Thalamus releases on GitHub Releases.
 *
 * Periodically checks for updates and can download + install
 * the latest version automatically.
 */
class AutoUpdater : public QObject
{
    Q_OBJECT

public:
    explicit AutoUpdater(QObject *parent = nullptr);
    ~AutoUpdater();

    /// Set the current app version
    void setCurrentVersion(const QString &version);

    /// Check for updates (async)
    void checkForUpdates();

    /// Download and install the latest version
    void downloadUpdate(const QString &url, const QString &filename = "");

    /// Get latest available version
    QString latestVersion() const { return m_latestVersion; }

    /// Check if update is available
    bool updateAvailable() const;

    /// Start periodic checks (default: every 24 hours)
    void startPeriodicChecks(int intervalHours = 24);

    /// Stop periodic checks
    void stopPeriodicChecks();

    /// GitHub Releases API URL
    void setReleasesUrl(const QString &url) { m_releasesUrl = url; }

signals:
    void updateAvailable(const QString &currentVersion, const QString &latestVersion);
    void upToDate();
    void checkError(const QString &error);
    void downloadProgress(qint64 received, qint64 total);
    void downloadComplete(const QString &filePath);
    void downloadError(const QString &error);

private slots:
    void onCheckReply(QNetworkReply *reply);

private:
    QNetworkAccessManager *m_network;
    QString m_currentVersion;
    QString m_latestVersion;
    QString m_downloadUrl;
    QString m_releasesUrl;
    QTimer *m_checkTimer;
};

#endif // AUTOUPDATER_H
