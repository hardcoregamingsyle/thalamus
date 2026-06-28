/**
 * Thalamus AI — Native Windows Desktop Application
 *
 * Built with Qt 6 (C++17) and Win32 API integration.
 * Provides: Chat, Research, Study, Code (9-agent pipeline),
 * and VM Sandbox (QEMU + VNC) in a single native app.
 *
 * Architecture:
 * - Qt 6 Widgets for the UI framework
 * - Convex HTTP API for backend communication
 * - Custom RFB 3.8 VNC client for VM display
 * - QProcess for QEMU/VM bridge management
 * - Win32 API for URI scheme registration and system integration
 *
 * Build prerequisites:
 * - CMake 3.22+
 * - Qt 6.5+ (Core, Gui, Widgets, Network, WebSockets, Svg)
 * - C++17 compatible compiler (MSVC 2022 recommended)
 * - Convex deployment (glad-ermine-937)
 */

#include <QApplication>
#include <QStyleFactory>
#include <QFile>
#include <QDir>
#include <QSettings>
#include <QStandardPaths>
#include <QMessageBox>
#include <QFontDatabase>
#include <QSplashScreen>
#include <QTimer>
#include <QProcess>
#include <QLockFile>
#include <QDir>

#include "MainWindow.h"

int main(int argc, char *argv[])
{
    // High DPI support
#if QT_VERSION >= QT_VERSION_CHECK(6, 0, 0)
    QApplication::setHighDpiScaleFactorRoundingPolicy(
        Qt::HighDpiScaleFactorRoundingPolicy::PassThrough);
#endif

    QApplication app(argc, argv);
    app.setApplicationName("Thalamus AI");
    app.setApplicationDisplayName("Thalamus AI");
    app.setOrganizationName("Thalamus");
    app.setOrganizationDomain("thalamus.dev");
    app.setApplicationVersion("1.0.0");
    app.setWindowIcon(QIcon(":/icons/app.ico"));

    // Use Fusion style as base for consistent dark theme
    app.setStyle(QStyleFactory::create("Fusion"));

    // ── Single instance lock ────────────────────────────────────────────────
    QString lockPath = QStandardPaths::writableLocation(QStandardPaths::TempLocation)
                       + "/thalamus-app.lock";
    QLockFile lockFile(lockPath);
    if (!lockFile.tryLock(100)) {
        // Another instance is already running — bring it to foreground
        QMessageBox::information(nullptr, "Thalamus AI",
            "Thalamus AI is already running.");
        return 0;
    }

    // ── Register thalamus:// URI scheme (Win32) ────────────────────────────
#ifdef Q_OS_WIN
    QSettings uriSettings(
        "HKEY_CURRENT_USER\\Software\\Classes\\thalamus",
        QSettings::NativeFormat);
    uriSettings.setValue(".", "URL:Thalamus Protocol");
    uriSettings.setValue("URL Protocol", "");
    uriSettings.setValue(
        "shell\\open\\command\\.",
        "\"" + QDir::toNativeSeparators(app.applicationFilePath()) + "\" \"%1\"");
#endif

    // ── Load custom fonts ───────────────────────────────────────────────────
    // Segoe UI is the default Windows font, loaded via system

    // ── Splash screen ───────────────────────────────────────────────────────
    QSplashScreen splash;
    splash.setWindowFlags(Qt::WindowStaysOnTopHint | Qt::FramelessWindowHint);
    splash.resize(400, 250);
    splash.setStyleSheet(
        "QSplashScreen {"
        "  background: qlineargradient(x1:0, y1:0, x2:1, y2:1,"
        "    stop:0 #0d0d0d, stop:1 #1a1a1a);"
        "  border: 1px solid #2a2a2a;"
        "}"
    );
    splash.showMessage(
        "<div style='text-align:center; padding-top:60px;'>"
        "<span style='font-size:48px; color:#a78bfa;'>◆</span><br>"
        "<span style='font-size:24px; font-weight:700; color:#fff;'>Thalamus AI</span><br>"
        "<span style='font-size:12px; color:#888;'>v1.0.0 — Loading...</span>"
        "</div>",
        Qt::AlignCenter, QColor(0xa7, 0x8b, 0xfa));
    splash.show();
    app.processEvents();

    // ── Create and show main window ─────────────────────────────────────────
    MainWindow mainWindow;

    // Check if we should start minimized
    QSettings settings("Thalamus", "ThalamusAI");
    bool startMinimized = settings.value("startMinimized", false).toBool();

    if (startMinimized) {
        mainWindow.hide();
    } else {
        mainWindow.show();
    }

    splash.finish(&mainWindow);

    // ── Initialize ──────────────────────────────────────────────────────────
    QTimer::singleShot(100, [&mainWindow]() {
        mainWindow.initialize();
    });

    return app.exec();
}
