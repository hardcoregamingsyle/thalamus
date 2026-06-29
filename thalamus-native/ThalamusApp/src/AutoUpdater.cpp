#include "AutoUpdater.h"
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QTimer>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QCoreApplication>
#include <QProcess>
#include <QStandardPaths>

AutoUpdater::AutoUpdater(QObject *parent)
    : QObject(parent)
    , m_network(new QNetworkAccessManager(this))
    , m_currentVersion("1.0.0")
    , m_releasesUrl("https://api.github.com/repos/hardcoregamingsyle/thalamus/releases/latest")
    , m_checkTimer(nullptr)
{
}

AutoUpdater::~AutoUpdater()
{
    stopPeriodicChecks();
}

void AutoUpdater::setCurrentVersion(const QString &version)
{
    m_currentVersion = version;
}

void AutoUpdater::checkForUpdates()
{
    QNetworkRequest req{QUrl(m_releasesUrl)};
    req.setRawHeader("Accept", "application/vnd.github.v3+json");
    req.setRawHeader("User-Agent", "ThalamusAI");

    QNetworkReply *reply = m_network->get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        onCheckReply(reply);
    });
}

void AutoUpdater::onCheckReply(QNetworkReply *reply)
{
    reply->deleteLater();

    if (reply->error() != QNetworkReply::NoError) {
        // Check if rate limited
        if (reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() == 403) {
            emit checkError("GitHub API rate limited. Will retry later.");
        } else {
            emit checkError("Update check failed: " + reply->errorString());
        }
        return;
    }

    QByteArray data = reply->readAll();
    QJsonDocument doc = QJsonDocument::fromJson(data);
    QJsonObject release = doc.object();

    m_latestVersion = release["tag_name"].toString();
    if (m_latestVersion.startsWith('v')) {
        m_latestVersion = m_latestVersion.mid(1);
    }

    // Get download URL
    QJsonArray assets = release["assets"].toArray();
    for (const QJsonValue &asset : assets) {
        QJsonObject a = asset.toObject();
        QString name = a["name"].toString();
        if (name.contains("Setup") && name.endsWith(".exe")) {
            m_downloadUrl = a["browser_download_url"].toString();
            break;
        }
    }

    // Compare versions
    QVersionNumber current = QVersionNumber::fromString(m_currentVersion);
    QVersionNumber latest = QVersionNumber::fromString(m_latestVersion);

    if (!latest.isNull() && latest > current) {
        emit updateAvailable(m_currentVersion, m_latestVersion);
    } else {
        emit upToDate();
    }
}

void AutoUpdater::downloadUpdate(const QString &url, const QString &filename)
{
    QString downloadUrl = url.isEmpty() ? m_downloadUrl : url;
    if (downloadUrl.isEmpty()) {
        emit downloadError("No download URL available");
        return;
    }

    // Determine save path
    QString saveName = filename.isEmpty() ? "Thalamus-Setup-" + m_latestVersion + ".exe" : filename;
    QString savePath = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation) + "/" + saveName;

    QNetworkRequest req{QUrl(downloadUrl)};
    QNetworkReply *reply = m_network->get(req);

    connect(reply, &QNetworkReply::downloadProgress, this, [this](qint64 received, qint64 total) {
        emit downloadProgress(received, total);
    });

    connect(reply, &QNetworkReply::finished, this, [this, reply, savePath]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            emit downloadError(reply->errorString());
            return;
        }

        QFile file(savePath);
        if (file.open(QIODevice::WriteOnly)) {
            file.write(reply->readAll());
            file.close();
            emit downloadComplete(savePath);

            // Launch installer
            QProcess::startDetached("\"" + savePath + "\"", QStringList());
            QCoreApplication::quit();
        } else {
            emit downloadError("Could not save update file to " + savePath);
        }
    });
}

bool AutoUpdater::updateAvailable() const
{
    if (m_latestVersion.isEmpty()) return false;
    QVersionNumber current = QVersionNumber::fromString(m_currentVersion);
    QVersionNumber latest = QVersionNumber::fromString(m_latestVersion);
    return !latest.isNull() && latest > current;
}

void AutoUpdater::startPeriodicChecks(int intervalHours)
{
    if (!m_checkTimer) {
        m_checkTimer = new QTimer(this);
        connect(m_checkTimer, &QTimer::timeout, this, &AutoUpdater::checkForUpdates);
    }
    m_checkTimer->start(intervalHours * 3600000); // Convert hours to ms

    // Also check immediately
    checkForUpdates();
}

void AutoUpdater::stopPeriodicChecks()
{
    if (m_checkTimer) {
        m_checkTimer->stop();
    }
}
