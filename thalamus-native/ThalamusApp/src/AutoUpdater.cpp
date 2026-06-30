// Thalamus AI — AutoUpdater.cpp
#include "AutoUpdater.h"
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QProcess>
#include <QVersionNumber>
#include <QCoreApplication>

AutoUpdater::AutoUpdater(QObject *parent)
    : QObject(parent)
    , m_networkManager(new QNetworkAccessManager(this))
    , m_currentVersion(QCoreApplication::applicationVersion())
    , m_repoOwner("hardcoregamingsyle")
    , m_repoName("thalamus")
    , m_updateAvailable(false)
{}

QString AutoUpdater::currentVersion() const { return m_currentVersion; }
QString AutoUpdater::latestVersion() const { return m_latestVersion; }
bool AutoUpdater::updateAvailable() const { return m_updateAvailable; }

void AutoUpdater::checkForUpdates()
{
    QString url = QString("https://api.github.com/repos/%1/%2/releases/latest")
        .arg(m_repoOwner, m_repoName);

    QNetworkRequest request(QUrl(url));
    request.setRawHeader("Accept", "application/vnd.github.v3+json");
    request.setRawHeader("User-Agent", "ThalamusAI/1.0.0");

    QNetworkReply *reply = m_networkManager->get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit error("Failed to check for updates: " + reply->errorString());
            return;
        }
        parseRelease(reply->readAll());
    });
}

void AutoUpdater::parseRelease(const QByteArray &data)
{
    QJsonDocument doc = QJsonDocument::fromJson(data);
    QJsonObject release = doc.object();

    m_latestVersion = release["tag_name"].toString();
    if (m_latestVersion.startsWith('v'))
        m_latestVersion = m_latestVersion.mid(1);

    QVersionNumber current = QVersionNumber::fromString(m_currentVersion);
    QVersionNumber latest = QVersionNumber::fromString(m_latestVersion);

    if (!latest.isNull() && latest > current) {
        // Find the asset URL for the MSI installer
        QJsonArray assets = release["assets"].toArray();
        for (const QJsonValue &asset : assets) {
            QJsonObject obj = asset.toObject();
            QString name = obj["name"].toString();
            if (name.endsWith(".msi") || name.endsWith(".exe")) {
                m_downloadUrl = obj["browser_download_url"].toString();
                break;
            }
        }
        m_updateAvailable = true;
        emit updateAvailable(m_latestVersion, m_downloadUrl);
    } else {
        m_updateAvailable = false;
        emit upToDate();
    }
}

void AutoUpdater::downloadUpdate(const QString &url)
{
    QNetworkRequest request(QUrl(url));
    QNetworkReply *reply = m_networkManager->get(request);

    connect(reply, &QNetworkReply::downloadProgress,
            this, &AutoUpdater::downloadProgress);

    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit error("Download failed: " + reply->errorString());
            return;
        }

        // Save to temp directory
        QString tempPath = QDir::tempPath() + "/Thalamus-Update.msi";
        QFile file(tempPath);
        if (file.open(QIODevice::WriteOnly)) {
            file.write(reply->readAll());
            file.close();
            emit downloadComplete(tempPath);
        } else {
            emit error("Failed to save update file");
        }
    });
}

void AutoUpdater::installUpdate(const QString &filePath)
{
    if (!QFile::exists(filePath)) {
        emit error("Update file not found: " + filePath);
        return;
    }

    // Launch MSI installer and quit
    if (!QProcess::startDetached("msiexec", {"/i", filePath, "/qb"})) {
        emit error("Failed to launch installer");
        return;
    }

    QCoreApplication::quit();
}
