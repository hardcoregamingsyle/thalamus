// Thalamus AI — VNCWidget.cpp
#include "VNCWidget.h"
#include "VMBridgeManager.h"
#include <QPainter>
#include <QMouseEvent>
#include <QKeyEvent>

VNCWidget::VNCWidget(VMBridgeManager *bridge, QWidget *parent)
    : QWidget(parent), m_bridge(bridge)
    , m_frameBuffer(QSize(1024, 768), QImage::Format_RGB32)
    , m_active(false)
{
    m_frameBuffer.fill(qRgb(20, 20, 40));
    setMinimumSize(640, 480);
    setFocusPolicy(Qt::StrongFocus);
}

void VNCWidget::start() { m_active = true; setFocus(); }
void VNCWidget::stop() { m_active = false; }

void VNCWidget::paintEvent(QPaintEvent *)
{
    QPainter p(this);
    p.setRenderHint(QPainter::SmoothPixmapTransform);
    QImage scaled = m_frameBuffer.scaled(size(), Qt::KeepAspectRatio, Qt::SmoothTransformation);
    int x = (width()-scaled.width())/2, y = (height()-scaled.height())/2;
    p.fillRect(rect(), QColor(10, 10, 20));
    p.drawImage(x, y, scaled);
    p.setPen(QColor(40, 40, 60));
    p.drawRect(x-1, y-1, scaled.width()+2, scaled.height()+2);
}

void VNCWidget::mousePressEvent(QMouseEvent *e) {
    if (!m_active) return;
    int mask=0; if (e->button()==Qt::LeftButton) mask|=1; if (e->button()==Qt::RightButton) mask|=4;
    m_bridge->sendPointerEvent(e->pos().x(), e->pos().y(), mask);
}
void VNCWidget::mouseReleaseEvent(QMouseEvent *e) {
    if (!m_active) return; m_bridge->sendPointerEvent(e->pos().x(), e->pos().y(), 0);
}
void VNCWidget::mouseMoveEvent(QMouseEvent *e) {
    if (!m_active) return;
    int mask=0; if (e->buttons()&Qt::LeftButton) mask|=1; if (e->buttons()&Qt::RightButton) mask|=4;
    m_bridge->sendPointerEvent(e->pos().x(), e->pos().y(), mask);
}
void VNCWidget::keyPressEvent(QKeyEvent *e) { if(m_active) m_bridge->sendKeyboardEvent(true, e->key()); }
void VNCWidget::keyReleaseEvent(QKeyEvent *e) { if(m_active) m_bridge->sendKeyboardEvent(false, e->key()); }
