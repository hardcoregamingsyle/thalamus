#include "MainWindow.h"
#include "AuthDialog.h"
#include <QApplication>
#include <QCloseEvent>
#include <QMenuBar>
#include <QMessageBox>
#include <QSettings>
#include <QTimer>
#include <QDir>
#include <QProcess>
#include <QStyleFactory>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , m_client(new ConvexClient(this))
    , m_tabWidget(nullptr)
    , m_chatView(nullptr)
    , m_researchView(nullptr)
    , m_studyView(nullptr)
    , m_codeView(nullptr)
    , m_vmView(nullptr)
    , m_settingsPage(nullptr)
    , m_trayIcon(nullptr)
    , m_authenticated(false)
{
    setObjectName("MainWindow");
    applyTheme();
    setupUI();
    setupMenuBar();
    setupSystemTray();
    setupStatusBar();
    loadSettings();
}

MainWindow::~MainWindow()
{
    saveSettings();
}

void MainWindow::initialize()
{
    // Configure Convex client
    QSettings settings("Thalamus", "ThalamusAI");
    QString convexUrl = settings.value("convexUrl", "https://glad-ermine-937.convex.cloud").toString();
    QString siteUrl = settings.value("siteUrl", "https://thalamus.aphantic.skinticals.com").toString();

    m_client->setConvexUrl(convexUrl);
    m_client->setSiteUrl(siteUrl);

    // Connect signals
    connect(m_client, &ConvexClient::userFetched, this, &MainWindow::onUserFetched);
    connect(m_client, &ConvexClient::vmBridgeConnected, this, &MainWindow::onVmBridgeConnected);
    connect(m_client, &ConvexClient::vmBridgeDisconnected, this, &MainWindow::onVmBridgeDisconnected);
    connect(m_client, &ConvexClient::vmBridgeMessage, this, &MainWindow::onVmBridgeMessage);
    connect(m_client, &ConvexClient::loggedOut, this, [this]() {
        m_authenticated = false;
        m_userLabel->setText("Not signed in");
        updateTitleBar();
    });

    // Check saved auth
    checkAuth();
}

void MainWindow::setupUI()
{
    setWindowTitle("Thalamus AI");
    resize(1280, 800);
    setMinimumSize(900, 600);

    // Central tab widget
    m_tabWidget = new QTabWidget(this);
    m_tabWidget->setDocumentMode(true);
    m_tabWidget->setMovable(false);
    m_tabWidget->setTabPosition(QTabWidget::North);

    // Create views
    m_chatView = new ChatView(m_client, this);
    m_researchView = new ResearchView(m_client, this);
    m_studyView = new StudyView(m_client, this);
    m_codeView = new CodeModeView(m_client, this);
    m_vmView = new VMSandboxView(m_client, this);
    m_settingsPage = new Settings(m_client, this);

    // Add tabs
    m_tabWidget->addTab(m_chatView, "💬  Chat");
    m_tabWidget->addTab(m_researchView, "🔬  Research");
    m_tabWidget->addTab(m_studyView, "📚  Study");
    m_tabWidget->addTab(m_codeView, "⚡  Code");
    m_tabWidget->addTab(m_vmView, "🖥️  Sandbox");
    m_tabWidget->addTab(m_settingsPage, "⚙️  Settings");

    setCentralWidget(m_tabWidget);

    connect(m_tabWidget, &QTabWidget::currentChanged, this, &MainWindow::onTabChanged);
}

void MainWindow::setupMenuBar()
{
    // File menu
    QMenu *fileMenu = menuBar()->addMenu("&File");
    fileMenu->addAction("Sign Out", this, [this]() {
        m_client->logout();
        checkAuth();
    });
    fileMenu->addSeparator();
    fileMenu->addAction("E&xit", this, &QWidget::close, QKeySequence::Quit);

    // View menu
    QMenu *viewMenu = menuBar()->addMenu("&View");
    viewMenu->addAction("Chat", this, [this]() { m_tabWidget->setCurrentIndex(0); }, QKeySequence("Ctrl+1"));
    viewMenu->addAction("Research", this, [this]() { m_tabWidget->setCurrentIndex(1); }, QKeySequence("Ctrl+2"));
    viewMenu->addAction("Study", this, [this]() { m_tabWidget->setCurrentIndex(2); }, QKeySequence("Ctrl+3"));
    viewMenu->addAction("Code", this, [this]() { m_tabWidget->setCurrentIndex(3); }, QKeySequence("Ctrl+4"));
    viewMenu->addAction("Sandbox", this, [this]() { m_tabWidget->setCurrentIndex(4); }, QKeySequence("Ctrl+5"));
    viewMenu->addSeparator();
    viewMenu->addAction("Full Screen", this, [this]() {
        if (isFullScreen()) showNormal(); else showFullScreen();
    }, QKeySequence("F11"));

    // Help menu
    QMenu *helpMenu = menuBar()->addMenu("&Help");
    helpMenu->addAction("About Thalamus", this, &MainWindow::showAboutDialog);
    helpMenu->addAction("About Qt", qApp, &QApplication::aboutQt);
}

void MainWindow::setupSystemTray()
{
    if (!QSystemTrayIcon::isSystemTrayAvailable()) return;

    m_trayMenu = new QMenu(this);
    m_trayMenu->addAction("Show Window", this, &QWidget::show);
    m_trayMenu->addAction("Hide Window", this, &QWidget::hide);
    m_trayMenu->addSeparator();
    m_trayMenu->addAction("Quit", this, &QWidget::close);

    m_trayIcon = new QSystemTrayIcon(this);
    m_trayIcon->setContextMenu(m_trayMenu);
    m_trayIcon->setToolTip("Thalamus AI");
    m_trayIcon->setIcon(qApp->style()->standardIcon(QStyle::SP_ComputerIcon));
    m_trayIcon->show();

    connect(m_trayIcon, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::DoubleClick || reason == QSystemTrayIcon::Trigger) {
            show();
            raise();
            activateWindow();
        }
    });
}

void MainWindow::setupStatusBar()
{
    m_statusLabel = new QLabel("Ready");
    m_bridgeStatus = new QLabel("● Bridge: Offline");
    m_bridgeStatus->setStyleSheet("color: #ff6b6b; padding: 2px 8px; font-size: 11px;");
    m_userLabel = new QLabel("Not signed in");
    m_userLabel->setStyleSheet("padding: 2px 8px; font-size: 11px; color: #888;");

    statusBar()->addWidget(m_statusLabel, 1);
    statusBar()->addPermanentWidget(m_bridgeStatus);
    statusBar()->addPermanentWidget(m_userLabel);
}

void MainWindow::applyTheme()
{
    // Dark theme applied via stylesheet
    qApp->setStyleSheet(R"(
        QMainWindow { background: #0d0d0d; }
        QWidget { color: #e0e0e0; font-family: 'Segoe UI', 'Arial', sans-serif; }
        QTabWidget::pane { background: #111; border: none; }
        QTabBar::tab {
            background: #1a1a1a; color: #888; padding: 10px 20px;
            border: none; font-size: 12px; font-weight: 600;
        }
        QTabBar::tab:selected { background: #111; color: #a78bfa; border-bottom: 2px solid #a78bfa; }
        QTabBar::tab:hover:!selected { color: #ccc; background: #1e1e1e; }
        QMenuBar { background: #0d0d0d; color: #aaa; border-bottom: 1px solid #1a1a1a; padding: 2px; }
        QMenuBar::item:selected { background: #1a1a1a; color: #fff; }
        QMenu { background: #1a1a1a; border: 1px solid #2a2a2a; padding: 4px; }
        QMenu::item { padding: 8px 32px 8px 16px; border-radius: 4px; }
        QMenu::item:selected { background: #a78bfa22; color: #a78bfa; }
        QStatusBar { background: #0a0a0a; border-top: 1px solid #1a1a1a; font-size: 11px; }
        QScrollBar:vertical {
            background: #111; width: 8px; border: none;
        }
        QScrollBar::handle:vertical {
            background: #333; min-height: 30px; border-radius: 4px;
        }
        QScrollBar::handle:vertical:hover { background: #555; }
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
    )");
}

void MainWindow::checkAuth()
{
    QSettings settings("Thalamus", "ThalamusAI");
    QString savedToken = settings.value("auth/token").toString();

    if (!savedToken.isEmpty()) {
        m_client->loadSession(savedToken);
        // If session loads, userFetched will be emitted
        // Set a timer: if no user fetched within 3s, show auth
        QTimer::singleShot(3000, this, [this]() {
            if (!m_authenticated) {
                // Token may be expired — re-auth
                AuthDialog dialog(m_client, this);
                if (dialog.exec() == QDialog::Accepted && dialog.isAuthenticated()) {
                    onAuthResult(true);
                }
            }
        });
    } else {
        // Show auth dialog immediately (with slight delay for window to appear)
        QTimer::singleShot(500, this, [this]() {
            AuthDialog dialog(m_client, this);
            if (dialog.exec() == QDialog::Accepted && dialog.isAuthenticated()) {
                onAuthResult(true);
            }
        });
    }
}

void MainWindow::onAuthResult(bool success)
{
    if (success) {
        m_authenticated = true;
        // Token is already stored in client
        QSettings settings("Thalamus", "ThalamusAI");
        settings.setValue("auth/token", m_client->authToken());
        updateTitleBar();
        m_statusLabel->setText("Authenticated");
    }
}

void MainWindow::onUserFetched(const QJsonObject &user)
{
    m_authenticated = true;
    m_userId = user["_id"].toString();
    m_userName = user["name"].toString();
    m_userLabel->setText(m_userName.isEmpty() ? user["email"].toString() : m_userName);
    updateTitleBar();
}

void MainWindow::onTabChanged(int index)
{
    m_statusLabel->setText(m_tabWidget->tabText(index).remove(0, 2)); // Remove icon prefix
}

void MainWindow::onVmBridgeConnected()
{
    m_bridgeStatus->setText("● Bridge: Online");
    m_bridgeStatus->setStyleSheet("color: #51cf66; padding: 2px 8px; font-size: 11px;");
}

void MainWindow::onVmBridgeDisconnected()
{
    m_bridgeStatus->setText("● Bridge: Offline");
    m_bridgeStatus->setStyleSheet("color: #ff6b6b; padding: 2px 8px; font-size: 11px;");
}

void MainWindow::onVmBridgeMessage(const QJsonObject &msg)
{
    // Route to VM view
    m_vmView->handleBridgeMessage(msg);
}

void MainWindow::showAboutDialog()
{
    QMessageBox::about(this, "About Thalamus AI",
        "<h2>Thalamus AI</h2>"
        "<p>Version 1.0.0</p>"
        "<p>The world's first L4.5 Agent Platform.</p>"
        "<p>Combines AI chat, deep research, autonomous coding, "
        "and full OS virtualisation in a single native Windows app.</p>"
        "<hr>"
        "<p style='color: #888; font-size: 11px;'>"
        "Built with Qt 6 | Convex Backend | QEMU Virtualisation</p>"
    );
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    saveSettings();
    if (m_trayIcon && m_trayIcon->isVisible()) {
        hide();
        event->ignore();
    }
}

void MainWindow::changeEvent(QEvent *event)
{
    if (event->type() == QEvent::WindowStateChange) {
        if (isMinimized() && m_trayIcon && m_trayIcon->isVisible()) {
            hide();
            event->ignore();
            return;
        }
    }
    QMainWindow::changeEvent(event);
}

void MainWindow::loadSettings()
{
    QSettings settings("Thalamus", "ThalamusAI");
    restoreGeometry(settings.value("geometry").toByteArray());
    restoreState(settings.value("windowState").toByteArray());
    int tabIndex = settings.value("lastTab", 0).toInt();
    m_tabWidget->setCurrentIndex(tabIndex);
}

void MainWindow::saveSettings()
{
    QSettings settings("Thalamus", "ThalamusAI");
    settings.setValue("geometry", saveGeometry());
    settings.setValue("windowState", saveState());
    settings.setValue("lastTab", m_tabWidget->currentIndex());
    if (m_authenticated) {
        settings.setValue("auth/token", m_client->authToken());
    }
}

void MainWindow::updateTitleBar()
{
    QString title = "Thalamus AI";
    if (m_authenticated && !m_userName.isEmpty()) {
        title += " — " + m_userName;
    }
    setWindowTitle(title);
}
