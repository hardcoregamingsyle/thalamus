// Thalamus AI — Native Windows Desktop App
// Main entry point: single-instance, URI scheme, system tray

#include <QApplication>
#include <QLocalServer>
#include <QLocalSocket>
#include <QStyleFactory>
#include <QFile>
#include <QDir>
#include <QSettings>
#include <QFileInfo>
#include "MainWindow.h"

#ifdef Q_OS_WIN
#include <windows.h>
#endif

static const char *LOCAL_SERVER_NAME = "ThalamusAISingleInstance";

static void sendUriToRunningInstance(const QString &uri)
{
    QLocalSocket socket;
    socket.connectToServer(LOCAL_SERVER_NAME);
    if (socket.waitForConnected(2000)) {
        QByteArray data = uri.toUtf8();
        socket.write(data);
        socket.waitForBytesWritten(1000);
        socket.waitForDisconnected(1000);
    }
}

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    app.setApplicationName("Thalamus AI");
    app.setApplicationVersion("1.0.0");
    app.setOrganizationName("Thalamus AI");
    app.setOrganizationDomain("thalamus.ai");
    app.setWindowIcon(QIcon(":/icons/app.ico"));

    app.setStyle(QStyleFactory::create("Fusion"));

    QFile styleFile(":/style.qss");
    if (styleFile.open(QFile::ReadOnly | QFile::Text)) {
        app.setStyleSheet(QString::fromUtf8(styleFile.readAll()));
        styleFile.close();
    }

    // Single-instance enforcement
    QLocalSocket pingSocket;
    pingSocket.connectToServer(LOCAL_SERVER_NAME);
    bool isFirstInstance = !pingSocket.waitForConnected(500);
    pingSocket.disconnectFromServer();

    if (!isFirstInstance) {
        if (argc > 1) {
            QString uri = QString::fromUtf8(argv[1]);
            if (uri.startsWith("thalamus://"))
                sendUriToRunningInstance(uri);
        } else {
            sendUriToRunningInstance("thalamus://activate");
        }
        return 0;
    }

    QLocalServer localServer;
    QLocalServer::removeServer(LOCAL_SERVER_NAME);
    localServer.listen(LOCAL_SERVER_NAME);

#ifdef Q_OS_WIN
    {
        QSettings uriScheme(
            "HKEY_CURRENT_USER\\Software\\Classes\\thalamus",
            QSettings::NativeFormat);
        uriScheme.setValue("Default", "URL:Thalamus AI Protocol");
        uriScheme.setValue("URL Protocol", "");

        QSettings uriCmd(
            "HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open\\command",
            QSettings::NativeFormat);
        QString appPath = QDir::toNativeSeparators(QFileInfo(argv[0]).absoluteFilePath());
        uriCmd.setValue("Default",
            QString("\"%1\" \"%2\"").arg(appPath).arg("%1"));
    }
#endif

    MainWindow mainWindow;

    QObject::connect(&localServer, &QLocalServer::newConnection, [&]() {
        QLocalSocket *client = localServer.nextPendingConnection();
        if (client) {
            client->waitForReadyRead(2000);
            QString uri = QString::fromUtf8(client->readAll());
            if (uri == "thalamus://activate") {
                mainWindow.show();
                mainWindow.raise();
                mainWindow.activateWindow();
            } else {
                mainWindow.handleUri(uri);
            }
            client->deleteLater();
        }
    });

    mainWindow.show();
    return app.exec();
}
