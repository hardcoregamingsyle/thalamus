// Thalamus AI — VNCWidget.cpp
#include "VNCWidget.h"
#include "VMBridgeManager.h"
#include <QPainter>
#include <QMouseEvent>
#include <QKeyEvent>
#include <QGuiApplication>
#include <QScreen>

VNCWidget::VNCWidget(VMBridgeManager *bridge, QWidget *parent)
    : QWidget(parent)
    , m_bridge(bridge)
    , m_frameBuffer(QSize(1024, 768), QImage::Format_RGB32)
    , m_pollTimer(new QTimer(this))
    , m_active(false)
{
    m_frameBuffer.fill(qRgb(20, 20, 40));
    setMinimumSize(640, 480);
    setFocusPolicy(Qt::StrongFocus);

    connect(m_pollTimer, &QTimer::timeout, this, [this]() {
        if (m_active && m_bridge && m_bridge->isRunning()) {
            update();
        }
    });
}

void VNCWidget::start()
{
    m_active = true;
    m_pollTimer->start(100); // 10 fps polling
    setFocus();
}

void VNCWidget::stop()
{
    m_active = false;
    m_pollTimer->stop();
}

void VNCWidget::paintEvent(QPaintEvent *)
{
    QPainter painter(this);
    painter.setRenderHint(QPainter::SmoothPixmapTransform);

    // Scale framebuffer to widget size, maintaining aspect ratio
    QImage scaled = m_frameBuffer.scaled(
        size(), Qt::KeepAspectRatio, Qt::SmoothTransformation);
    int x = (width() - scaled.width()) / 2;
    int y = (height() - scaled.height()) / 2;

    // Fill background
    painter.fillRect(rect(), QColor(10, 10, 20));
    painter.drawImage(x, y, scaled);

    // Draw border around VM display
    painter.setPen(QColor(40, 40, 60));
    painter.drawRect(x - 1, y - 1, scaled.width() + 2, scaled.height() + 2);
}

void VNCWidget::mousePressEvent(QMouseEvent *event)
{
    if (!m_active) return;
    int buttonMask = 0;
    if (event->button() == Qt::LeftButton) buttonMask |= 1;
    if (event->button() == Qt::MiddleButton) buttonMask |= 2;
    if (event->button() == Qt::RightButton) buttonMask |= 4;
    m_bridge->sendPointerEvent(event->pos().x(), event->pos().y(), buttonMask);
}

void VNCWidget::mouseReleaseEvent(QMouseEvent *event)
{
    if (!m_active) return;
    m_bridge->sendPointerEvent(event->pos().x(), event->pos().y(), 0);
}

void VNCWidget::mouseMoveEvent(QMouseEvent *event)
{
    if (!m_active) return;
    int buttonMask = 0;
    if (event->buttons() & Qt::LeftButton) buttonMask |= 1;
    if (event->buttons() & Qt::RightButton) buttonMask |= 4;
    m_bridge->sendPointerEvent(event->pos().x(), event->pos().y(), buttonMask);
}

void VNCWidget::keyPressEvent(QKeyEvent *event)
{
    if (!m_active) return;
    // Convert Qt key to X11 keysym (simplified — full mapping would be extensive)
    quint32 keysym = event->key();
    m_bridge->sendKeyboardEvent(true, keysym);
}

void VNCWidget::keyReleaseEvent(QKeyEvent *event)
{
    if (!m_active) return;
    quint32 keysym = event->key();
    m_bridge->sendKeyboardEvent(false, keysym);
}
