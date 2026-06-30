// Thalamus AI — Native Windows Desktop App
// Main entry point: single-instance, URI scheme, system tray

#include <QApplication>
#include <QMessageBox>
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

static const char *APP_GUID = "thalamus-ai-7a4c9f82-1e3b-4f6d-8c0a-5b2d7e9f1a3c";
static const char *LOCAL_SERVER_NAME = "ThalamusAISingleInstance";

// Forward a thalamus:// URI to the running instance
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

// Handle WM_COPYDATA for URI scheme from browser
#ifdef Q_OS_WIN
static bool handleWindowsMessage(MSG *msg, Qt::HANDle *)
{
    if (msg->message == WM_COPYDATA) {
        COPYDATASTRUCT *cds = reinterpret_cast<COPYDATASTRUCT *>(msg->lParam);
        if (cds->dwData == 0x5448414C) { // 'THAL'
            QString uri = QString::fromUtf8(
                reinterpret_cast<const char *>(cds->lpData), cds->cbData);
            // Find MainWindow and open URI
            for (QWidget *w : QApplication::topLevelWidgets()) {
                if (auto *mw = qobject_cast<MainWindow *>(w)) {
                    mw->handleUri(uri);
                    break;
                }
            }
        }
    }
    return false;
}
#endif

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    app.setApplicationName("Thalamus AI");
    app.setApplicationVersion("1.0.0");
    app.setOrganizationName("Thalamus AI");
    app.setOrganizationDomain("thalamus.ai");
    app.setWindowIcon(QIcon(":/icons/app.ico"));

    // Force Fusion style for consistent dark theme
    app.setStyle(QStyleFactory::create("Fusion"));

    // ── Load stylesheet ─────────────────────────────────────────────────────
    QFile styleFile(":/style.qss");
    if (styleFile.open(QFile::ReadOnly | QFile::Text)) {
        QString styleSheet = QString::fromUtf8(styleFile.readAll());
        app.setStyleSheet(styleSheet);
        styleFile.close();
    }

    // ── Single-instance enforcement ─────────────────────────────────────────
    QLocalSocket pingSocket;
    pingSocket.connectToServer(LOCAL_SERVER_NAME);
    bool isFirstInstance = !pingSocket.waitForConnected(500);

    if (!isFirstInstance) {
        // Forward any URI from argv[1] to the running instance
        if (argc > 1) {
            QString uri = QString::fromUtf8(argv[1]);
            if (uri.startsWith("thalamus://")) {
                sendUriToRunningInstance(uri);
            }
        } else {
            // Just bring the running instance to front
            sendUriToRunningInstance("thalamus://activate");
        }
        return 0;
    }

    // ── Start local server for single-instance IPC ──────────────────────────
    QLocalServer localServer;
    // Clean up stale server name if previous instance crashed
    QLocalServer::removeServer(LOCAL_SERVER_NAME);
    localServer.listen(LOCAL_SERVER_NAME);

    // ── Register thalamus:// URI scheme (Windows) ───────────────────────────
#ifdef Q_OS_WIN
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

    // Install native event filter for WM_COPYDATA
    // app.installNativeEventFilter(...) — handled via qApp->nativeEvent
#endif

    // ── Create main window ──────────────────────────────────────────────────
    MainWindow mainWindow;

    // Handle URI from second instance
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
