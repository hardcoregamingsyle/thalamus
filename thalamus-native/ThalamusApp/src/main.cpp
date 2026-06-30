/**
 * Thalamus AI — Native Windows Desktop App
 * Entry point: single-instance lock, URI scheme registration, dark theme
 */

#include <QApplication>
#include <QSharedMemory>
#include <QMessageBox>
#include <QFile>
#include <QDir>
#include <QStandardPaths>
#include <QSettings>

#include "MainWindow.h"
#include "Settings.h"

#ifdef Q_OS_WIN
#include <windows.h>
#include <shellapi.h>
#endif

static const char *SHARED_MEMORY_KEY = "thalamus-ai-single-instance";
static const char *URI_SCHEME = "thalamus";

#ifdef Q_OS_WIN
static void registerUriScheme() {
    QSettings reg("HKEY_CLASSES_ROOT", QSettings::NativeFormat);
    QString appPath = QDir::toNativeSeparators(QCoreApplication::applicationFilePath());

    reg.setValue(QString("%1/Default").arg(URI_SCHEME), "URL:Thalamus AI Protocol");
    reg.setValue(QString("%1/URL Protocol").arg(URI_SCHEME), "");

    QSettings icon("HKEY_CLASSES_ROOT", QSettings::NativeFormat);
    icon.setValue(QString("%1/DefaultIcon/Default").arg(URI_SCHEME), QString("\"%1\",0").arg(appPath));

    QSettings cmd("HKEY_CLASSES_ROOT", QSettings::NativeFormat);
    cmd.setValue(QString("%1/shell/open/command/Default").arg(URI_SCHEME),
                 QString("\"%1\" --uri \"%2\"").arg(appPath, "%1"));
}
#endif

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("Thalamus AI");
    app.setOrganizationName("Aphantic Corporations");
    app.setApplicationVersion("1.0.0");
    app.setQuitOnLastWindowClosed(false); // stay in tray

    // Single-instance enforcement via shared memory
    QSharedMemory mem(SHARED_MEMORY_KEY);
    if (!mem.create(1)) {
        QMessageBox::information(nullptr, "Thalamus AI",
            "Thalamus AI is already running.\nCheck your system tray.");
        return 0;
    }

    // Register thalamus:// URI scheme (Windows)
#ifdef Q_OS_WIN
    registerUriScheme();
#endif

    // Handle --uri argument for deep linking
    const QStringList args = app.arguments();
    for (int i = 1; i < args.size(); ++i) {
        if (args[i] == "--uri" && i + 1 < args.size()) {
            QString uri = args[i + 1];
            // Will be forwarded to MainWindow after creation
            Q_UNUSED(uri);
        }
    }

    // Load dark theme stylesheet
    QFile styleFile(":/style.qss");
    if (styleFile.open(QFile::ReadOnly | QFile::Text)) {
        app.setStyleSheet(styleFile.readAll());
        styleFile.close();
    }

    // Create and show main window
    MainWindow window;
    window.show();

    return app.exec();
}
