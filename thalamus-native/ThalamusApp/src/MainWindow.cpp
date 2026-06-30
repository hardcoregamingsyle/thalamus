/**
 * Thalamus AI — Main Window
 * Tabbed interface: Chat, Research, Study, Code, VM Sandbox
 * System tray integration and VM bridge lifecycle management.
 */

#include "MainWindow.h"
#include "ConvexClient.h"
#include "VMBridgeManager.h"
#include "ChatView.h"
#include "ResearchView.h"
#include "StudyView.h"
#include "CodeModeView.h"
#include "VMSandboxView.h"
#include "Settings.h"
#include "NotificationManager.h"

#include <QApplication>
#include <QMenuBar>
#include <QStatusBar>
#include <QVBoxLayout>
#include <QMessageBox>
#include <QDesktopServices>
#include <QUrl>
#include <QStyle>
#include <QFont>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , m_tabs(new QTabWidget(this))
    , m_trayIcon(new QSystemTrayIcon(this))
    , m_trayMenu(new QMenu(this))
    , m_convexClient(new ConvexClient(this))
    , m_bridgeManager(new VMBridgeManager(this))
    , m_chatView(nullptr)
    , m_researchView(nullptr)
    , m_studyView(nullptr)
    , m_codeModeView(nullptr)
    , m_vmSandboxView(nullptr)
    , m_trayShowAction(nullptr)
    , m_bridgeStatusAction(nullptr)
{
    setWindowTitle("Thalamus AI");
    setMinimumSize(1100, 720);
    resize(1280, 800);

    setupUi();
    setupSystemTray();
    setupMenuBar();

    statusBar()->showMessage("Ready");

    // Connect bridge signals
    connect(m_bridgeManager, &VMBridgeManager::connected,
            this, &MainWindow::onBridgeConnected);
    connect(m_bridgeManager, &VMBridgeManager::disconnected,
            this, &MainWindow::onBridgeDisconnected);

    // Try connecting to VM bridge
    m_bridgeManager->connectToBridge();
}

MainWindow::~MainWindow() {}

void MainWindow::setupUi() {
    m_chatView = new ChatView(m_convexClient, this);
    m_researchView = new ResearchView(m_convexClient, this);
    m_studyView = new StudyView(m_convexClient, this);
    m_codeModeView = new CodeModeView(m_convexClient, this);
    m_vmSandboxView = new VMSandboxView(m_bridgeManager, this);

    m_tabs->setTabPosition(QTabWidget::North);
    m_tabs->setDocumentMode(true);

    m_tabs->addTab(m_chatView, QIcon(), "💬 Chat");
    m_tabs->addTab(m_researchView, QIcon(), "🔬 Research");
    m_tabs->addTab(m_studyView, QIcon(), "📚 Study");
    m_tabs->addTab(m_codeModeView, QIcon(), "⚡ Code");
    m_tabs->addTab(m_vmSandboxView, QIcon(), "🖥️ VM Sandbox");

    m_tabs->setStyleSheet(
        "QTabWidget::pane { border: none; }"
        "QTabBar::tab { padding: 10px 20px; font-size: 13px; }"
        "QTabBar::tab:selected { border-bottom: 2px solid #6366f1; }"
    );

    setCentralWidget(m_tabs);
}

void MainWindow::setupSystemTray() {
    m_trayShowAction = m_trayMenu->addAction("Show Window");
    connect(m_trayShowAction, &QAction::triggered, this, [this]() {
        showNormal();
        raise();
        activateWindow();
    });

    m_bridgeStatusAction = m_trayMenu->addAction("Bridge: Disconnected");
    m_bridgeStatusAction->setEnabled(false);

    m_trayMenu->addSeparator();

    QAction *aboutAction = m_trayMenu->addAction("About Thalamus AI");
    connect(aboutAction, &QAction::triggered, this, &MainWindow::onAbout);

    m_trayMenu->addSeparator();

    QAction *quitAction = m_trayMenu->addAction("Quit");
    connect(quitAction, &QAction::triggered, qApp, &QApplication::quit);

    m_trayIcon->setContextMenu(m_trayMenu);
    m_trayIcon->setToolTip("Thalamus AI");
    m_trayIcon->show();

    connect(m_trayIcon, &QSystemTrayIcon::activated,
            this, &MainWindow::onTrayActivated);
}

void MainWindow::setupMenuBar() {
    QMenuBar *bar = menuBar();

    QMenu *fileMenu = bar->addMenu("&File");
    fileMenu->addAction("&New Chat", this, &MainWindow::onNewChat, QKeySequence::New);
    fileMenu->addSeparator();
    fileMenu->addAction("&Settings...", this, &MainWindow::onSettingsRequested, QKeySequence::Preferences);
    fileMenu->addSeparator();
    fileMenu->addAction("E&xit", qApp, &QApplication::quit, QKeySequence::Quit);

    QMenu *helpMenu = bar->addMenu("&Help");
    helpMenu->addAction("&About", this, &MainWindow::onAbout);
    helpMenu->addAction("About &Qt", qApp, &QApplication::aboutQt);
}

void MainWindow::closeEvent(QCloseEvent *event) {
    if (m_trayIcon->isVisible()) {
        hide();
        event->ignore();
    }
}

void MainWindow::onTrayActivated(QSystemTrayIcon::ActivationReason reason) {
    if (reason == QSystemTrayIcon::DoubleClick) {
        showNormal();
        raise();
        activateWindow();
    }
}

void MainWindow::onSettingsRequested() {
    Settings dlg(this);
    dlg.exec();
}

void MainWindow::onAbout() {
    QMessageBox::about(this, "About Thalamus AI",
        "<h2>Thalamus AI</h2>"
        "<p>Version 1.0.0</p>"
        "<p>Native Windows Desktop App</p>"
        "<p>Built with Qt 6 C++</p>"
        "<p>&copy; 2026 Aphantic Corporations</p>");
}

void MainWindow::onNewChat() {
    m_tabs->setCurrentIndex(0); // Switch to Chat tab
    m_chatView->newConversation();
}

void MainWindow::handleUri(const QString &uri) {
    if (uri.startsWith("thalamus://launch-vm")) {
        m_tabs->setCurrentIndex(4); // VM Sandbox tab
    }
}

void MainWindow::onBridgeConnected() {
    m_bridgeStatusAction->setText("Bridge: Connected ✓");
    statusBar()->showMessage("VM Bridge connected on port 5900", 5000);
}

void MainWindow::onBridgeDisconnected() {
    m_bridgeStatusAction->setText("Bridge: Disconnected");
    statusBar()->showMessage("VM Bridge disconnected", 5000);
}
