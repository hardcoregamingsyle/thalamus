#include "MainWindow.h"
#include "ChatView.h"
#include "ResearchView.h"
#include "StudyView.h"
#include "CodeModeView.h"
#include "VMSandboxView.h"
#include "Settings.h"
#include "ConvexClient.h"
#include "AutoUpdater.h"
#include "NotificationManager.h"

#include <QApplication>
#include <QStyleFactory>
#include <QFont>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , m_navList(nullptr)
    , m_contentStack(nullptr)
    , m_chatView(nullptr)
    , m_researchView(nullptr)
    , m_studyView(nullptr)
    , m_codeView(nullptr)
    , m_vmView(nullptr)
    , m_settingsView(nullptr)
    , m_convexClient(nullptr)
    , m_updater(nullptr)
    , m_notifier(nullptr)
    , m_trayIcon(nullptr)
    , m_statusLabel(nullptr)
    , m_authenticated(false)
{
    setWindowTitle("Thalamus AI");
    resize(1280, 800);
    setMinimumSize(900, 600);

    applyDarkTheme();
    setupUI();
    setupTrayIcon();
    createViews();
    setupConnections();

    m_convexClient = new ConvexClient(this);
    m_updater = new AutoUpdater(this);
    m_notifier = new NotificationManager(this);

    m_contentStack->setCurrentIndex(0);
    updateStatusBar("Ready");
}

MainWindow::~MainWindow() = default;

void MainWindow::applyDarkTheme()
{
    // Fusion style with dark palette
    QApplication::setStyle(QStyleFactory::create("Fusion"));

    QPalette darkPalette;
    darkPalette.setColor(QPalette::Window, QColor(25, 25, 30));
    darkPalette.setColor(QPalette::WindowText, QColor(220, 220, 225));
    darkPalette.setColor(QPalette::Base, QColor(18, 18, 22));
    darkPalette.setColor(QPalette::AlternateBase, QColor(30, 30, 38));
    darkPalette.setColor(QPalette::ToolTipBase, QColor(45, 45, 55));
    darkPalette.setColor(QPalette::ToolTipText, QColor(220, 220, 225));
    darkPalette.setColor(QPalette::Text, QColor(220, 220, 225));
    darkPalette.setColor(QPalette::Button, QColor(35, 35, 45));
    darkPalette.setColor(QPalette::ButtonText, QColor(220, 220, 225));
    darkPalette.setColor(QPalette::BrightText, Qt::red);
    darkPalette.setColor(QPalette::Link, QColor(74, 140, 255));
    darkPalette.setColor(QPalette::Highlight, QColor(74, 108, 255));
    darkPalette.setColor(QPalette::HighlightedText, Qt::white);

    darkPalette.setColor(QPalette::Disabled, QPalette::WindowText, QColor(128, 128, 128));
    darkPalette.setColor(QPalette::Disabled, QPalette::Text, QColor(128, 128, 128));
    darkPalette.setColor(QPalette::Disabled, QPalette::ButtonText, QColor(128, 128, 128));

    QApplication::setPalette(darkPalette);
    QApplication::setFont(QFont("Segoe UI", 10));

    // Global stylesheet for fine-tuning
    setStyleSheet(
        "QMainWindow { background-color: #19191E; }"
        "QToolTip { color: #DCDCE1; background-color: #2D2D37; border: 1px solid #4A6CFF; padding: 4px; }"
        "QStatusBar { background-color: #15151A; color: #8B8B95; border-top: 1px solid #2A2A35; }"
        "QMenuBar { background-color: #15151A; color: #DCDCE1; border-bottom: 1px solid #2A2A35; }"
        "QMenuBar::item:selected { background-color: #2D2D37; }"
        "QMenu { background-color: #1E1E25; color: #DCDCE1; border: 1px solid #2A2A35; }"
        "QMenu::item:selected { background-color: #4A6CFF; }"
    );
}

void MainWindow::setupUI()
{
    auto *centralWidget = new QWidget(this);
    auto *mainLayout = new QHBoxLayout(centralWidget);
    mainLayout->setContentsMargins(0, 0, 0, 0);
    mainLayout->setSpacing(0);

    // Sidebar
    auto *sidebarWidget = new QWidget;
    sidebarWidget->setFixedWidth(220);
    sidebarWidget->setStyleSheet("background-color: #15151A; border-right: 1px solid #2A2A35;");

    auto *sidebarLayout = new QVBoxLayout(sidebarWidget);
    sidebarLayout->setContentsMargins(8, 16, 8, 16);
    sidebarLayout->setSpacing(4);

    auto *logoLabel = new QLabel("Thalamus AI");
    logoLabel->setStyleSheet("color: #4A6CFF; font-size: 18px; font-weight: bold; padding: 12px 8px;");
    logoLabel->setAlignment(Qt::AlignCenter);
    sidebarLayout->addWidget(logoLabel);

    auto *sep = new QFrame;
    sep->setFrameShape(QFrame::HLine);
    sep->setStyleSheet("color: #2A2A35;");
    sidebarLayout->addWidget(sep);

    m_navList = new QListWidget;
    m_navList->setStyleSheet(
        "QListWidget { background: transparent; border: none; color: #8B8B95; font-size: 13px; }"
        "QListWidget::item { padding: 10px 14px; border-radius: 6px; margin: 2px 0; }"
        "QListWidget::item:selected { background-color: #2A2A38; color: #DCDCE1; }"
        "QListWidget::item:hover { background-color: #222230; color: #B0B0BB; }"
    );

    const QStringList navItems = {"💬 Chat", "🔬 Research", "📚 Study", "💻 Code", "🖥️ VM Sandbox", "⚙️ Settings"};
    for (const auto &item : navItems) {
        auto *listItem = new QListWidgetItem(item);
        listItem->setSizeHint(QSize(0, 40));
        m_navList->addItem(listItem);
    }
    m_navList->setCurrentRow(0);

    sidebarLayout->addWidget(m_navList);
    sidebarLayout->addStretch();

    auto *versionLabel = new QLabel("v1.0.0");
    versionLabel->setStyleSheet("color: #555560; font-size: 11px; padding: 8px;");
    versionLabel->setAlignment(Qt::AlignCenter);
    sidebarLayout->addWidget(versionLabel);

    // Content
    m_contentStack = new QStackedWidget;
    m_contentStack->setStyleSheet("background-color: #19191E;");

    // Splitter for sidebar + content
    auto *splitter = new QSplitter(Qt::Horizontal);
    splitter->addWidget(sidebarWidget);
    splitter->addWidget(m_contentStack);
    splitter->setStretchFactor(0, 0);
    splitter->setStretchFactor(1, 1);
    splitter->setHandleWidth(0);

    mainLayout->addWidget(splitter);
    setCentralWidget(centralWidget);

    // Status bar
    m_statusLabel = new QLabel("Ready");
    m_statusLabel->setStyleSheet("padding: 4px 12px;");
    statusBar()->addPermanentWidget(m_statusLabel);
    statusBar()->setStyleSheet("QStatusBar { background: #15151A; border-top: 1px solid #2A2A35; }");
}

void MainWindow::setupTrayIcon()
{
    m_trayIcon = new QSystemTrayIcon(this);
    m_trayIcon->setIcon(QIcon(":/icons/app.ico"));
    m_trayIcon->setToolTip("Thalamus AI");

    auto *trayMenu = new QMenu(this);
    trayMenu->setStyleSheet(
        "QMenu { background-color: #1E1E25; color: #DCDCE1; border: 1px solid #2A2A35; }"
        "QMenu::item:selected { background-color: #4A6CFF; }"
    );

    trayMenu->addAction("Show Thalamus AI", this, &QMainWindow::show);
    trayMenu->addAction("Hide to Tray", this, &QMainWindow::hide);
    trayMenu->addSeparator();
    trayMenu->addAction("Exit", qApp, &QApplication::quit);

    m_trayIcon->setContextMenu(trayMenu);

    connect(m_trayIcon, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::DoubleClick) {
            show();
            raise();
            activateWindow();
        }
    });

    m_trayIcon->show();
}

void MainWindow::createViews()
{
    m_chatView = new ChatView(this);
    m_researchView = new ResearchView(this);
    m_studyView = new StudyView(this);
    m_codeView = new CodeModeView(this);
    m_vmView = new VMSandboxView(this);
    m_settingsView = new Settings(this);

    m_contentStack->addWidget(m_chatView);
    m_contentStack->addWidget(m_researchView);
    m_contentStack->addWidget(m_studyView);
    m_contentStack->addWidget(m_codeView);
    m_contentStack->addWidget(m_vmView);
    m_contentStack->addWidget(m_settingsView);
}

void MainWindow::setupConnections()
{
    connect(m_navList, &QListWidget::currentRowChanged, this, &MainWindow::onNavigate);
}

void MainWindow::onNavigate(int index)
{
    if (index >= 0 && index < m_contentStack->count()) {
        m_contentStack->setCurrentIndex(index);
    }
}

void MainWindow::showAuthDialog()
{
    // Auth is handled through the web portal
}

void MainWindow::onAuthSuccess(const QString &token)
{
    m_authToken = token;
    m_authenticated = true;
    updateStatusBar("Authenticated");
}

void MainWindow::updateStatusBar(const QString &message)
{
    if (m_statusLabel) {
        m_statusLabel->setText(message);
    }
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    if (m_trayIcon && m_trayIcon->isVisible()) {
        hide();
        m_trayIcon->showMessage("Thalamus AI", "Still running in the system tray.", QSystemTrayIcon::Information, 2000);
        event->ignore();
    } else {
        event->accept();
    }
}
