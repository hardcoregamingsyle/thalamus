// Thalamus AI — AutoUpdater.h
#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QString>
#include <QVersionNumber>

class AutoUpdater : public QObject
{
    Q_OBJECT

public:
    explicit AutoUpdater(QObject *parent = nullptr);
    ~AutoUpdater() = default;

    void checkForUpdates();
    void downloadUpdate(const QString &url);
    void installUpdate(const QString &filePath);

    QString currentVersion() const;
    QString latestVersion() const;
    bool updateAvailable() const;

signals:
    void updateAvailable(const QString &version, const QString &downloadUrl);
    void upToDate();
    void downloadProgress(qint64 received, qint64 total);
    void downloadComplete(const QString &filePath);
    void error(const QString &message);

private:
    void parseRelease(const QByteArray &data);

    QNetworkAccessManager *m_networkManager;
    QString m_currentVersion;
    QString m_latestVersion;
    QString m_downloadUrl;
    QString m_repoOwner;
    QString m_repoName;
    bool m_updateAvailable;
};
