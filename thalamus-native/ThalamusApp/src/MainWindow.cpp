// Thalamus AI — MainWindow.cpp
#include "MainWindow.h"
#include "ConvexClient.h"
#include "ChatView.h"
#include "ResearchView.h"
#include "StudyView.h"
#include "CodeModeView.h"
#include "VMSandboxView.h"
#include "Settings.h"
#include <QVBoxLayout>
#include <QAction>
#include <QMenuBar>
#include <QSettings>
#include <QCloseEvent>
#include <QApplication>
#include <QStatusBar>
#include <QLabel>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , m_tabWidget(nullptr), m_chatView(nullptr), m_researchView(nullptr)
    , m_studyView(nullptr), m_codeModeView(nullptr), m_vmSandboxView(nullptr)
    , m_settingsView(nullptr), m_trayIcon(nullptr), m_trayMenu(nullptr)
    , m_showAction(nullptr), m_quitAction(nullptr)
    , m_convexClient(new ConvexClient(this))
{
    setupUi();
    setupTrayIcon();
    restoreSettings();
}

MainWindow::~MainWindow() { saveSettings(); }

void MainWindow::setupUi()
{
    setWindowTitle("Thalamus AI");
    setMinimumSize(1024, 720);
    resize(1280, 860);

    m_tabWidget = new QTabWidget(this);
    m_tabWidget->setTabPosition(QTabWidget::South);
    m_tabWidget->setMovable(true);
    m_tabWidget->setDocumentMode(true);
    setCentralWidget(m_tabWidget);

    m_chatView = new ChatView(m_convexClient, this);
    m_researchView = new ResearchView(m_convexClient, this);
    m_studyView = new StudyView(m_convexClient, this);
    m_codeModeView = new CodeModeView(m_convexClient, this);
    m_vmSandboxView = new VMSandboxView(m_convexClient, this);
    m_settingsView = new Settings(m_convexClient, this);

    m_tabWidget->addTab(m_chatView, QIcon(), "Chat");
    m_tabWidget->addTab(m_researchView, QIcon(), "Research");
    m_tabWidget->addTab(m_studyView, QIcon(), "Study");
    m_tabWidget->addTab(m_codeModeView, QIcon(), "Code");
    m_tabWidget->addTab(m_vmSandboxView, QIcon(), "VM Sandbox");
    m_tabWidget->addTab(m_settingsView, QIcon(), "Settings");

    connect(m_tabWidget, &QTabWidget::currentChanged, this, &MainWindow::onTabChanged);

    statusBar()->setStyleSheet(
        "QStatusBar { background: #1e1e2e; color: #a0a0c0; border-top: 1px solid #2e2e3e; }"
        "QStatusBar::item { border: none; }");
    statusBar()->showMessage("Ready");
}

void MainWindow::setupTrayIcon()
{
    m_trayIcon = new QSystemTrayIcon(QIcon(":/icons/app.ico"), this);
    m_trayIcon->setToolTip("Thalamus AI");

    m_trayMenu = new QMenu(this);
    m_showAction = m_trayMenu->addAction("Show Thalamus");
    connect(m_showAction, &QAction::triggered, this, [this]() {
        show(); raise(); activateWindow();
    });
    m_trayMenu->addSeparator();
    m_quitAction = m_trayMenu->addAction("Quit");
    connect(m_quitAction, &QAction::triggered, qApp, &QApplication::quit);

    m_trayIcon->setContextMenu(m_trayMenu);
    connect(m_trayIcon, &QSystemTrayIcon::activated, this, &MainWindow::onTrayActivated);
    m_trayIcon->show();
}

void MainWindow::onTrayActivated(QSystemTrayIcon::ActivationReason reason)
{
    if (reason == QSystemTrayIcon::DoubleClick) {
        show(); raise(); activateWindow();
    }
}

void MainWindow::onTabChanged(int index)
{
    QWidget *w = m_tabWidget->widget(index);
    if (qobject_cast<ChatView *>(w))
        statusBar()->showMessage("Chat Mode");
    else if (qobject_cast<ResearchView *>(w))
        statusBar()->showMessage("Research Mode");
    else if (qobject_cast<StudyView *>(w))
        statusBar()->showMessage("Study Mode");
    else if (qobject_cast<CodeModeView *>(w))
        statusBar()->showMessage("Code Mode");
    else if (qobject_cast<VMSandboxView *>(w))
        statusBar()->showMessage("VM Sandbox");
    else if (qobject_cast<Settings *>(w))
        statusBar()->showMessage("Settings");
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    saveSettings();
    if (m_trayIcon && m_trayIcon->isVisible()) {
        hide();
        m_trayIcon->showMessage("Thalamus AI",
            "Minimized to tray. Double-click to restore.",
            QSystemTrayIcon::Information, 2000);
        event->ignore();
    } else {
        event->accept();
    }
}

void MainWindow::saveSettings()
{
    QSettings s;
    s.setValue("window/geometry", saveGeometry());
    s.setValue("window/state", saveState());
    s.setValue("window/tab", m_tabWidget->currentIndex());
    s.setValue("convex/baseUrl", m_convexClient->baseUrl());
}

void MainWindow::restoreSettings()
{
    QSettings s;
    if (s.contains("window/geometry"))
        restoreGeometry(s.value("window/geometry").toByteArray());
    if (s.contains("window/state"))
        restoreState(s.value("window/state").toByteArray());
    if (s.contains("window/tab"))
        m_tabWidget->setCurrentIndex(s.value("window/tab").toInt());
    if (s.contains("convex/baseUrl"))
        m_convexClient->setBaseUrl(s.value("convex/baseUrl").toString());
}

void MainWindow::handleUri(const QString &uri)
{
    show(); raise(); activateWindow();
    if (uri.startsWith("thalamus://chat"))
        m_tabWidget->setCurrentIndex(0);
    else if (uri.startsWith("thalamus://research"))
        m_tabWidget->setCurrentIndex(1);
    else if (uri.startsWith("thalamus://code"))
        m_tabWidget->setCurrentIndex(3);
}
