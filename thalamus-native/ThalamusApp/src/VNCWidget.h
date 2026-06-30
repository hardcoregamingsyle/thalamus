// Thalamus AI — VNCWidget.h
#pragma once

#include <QWidget>
#include <QImage>
#include <QPoint>
#include <QTimer>

class VMBridgeManager;

class VNCWidget : public QWidget
{
    Q_OBJECT

public:
    explicit VNCWidget(VMBridgeManager *bridge, QWidget *parent = nullptr);
    ~VNCWidget() = default;

    void start();
    void stop();

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void keyReleaseEvent(QKeyEvent *event) override;
    QSize sizeHint() const override { return QSize(1024, 768); }

private:
    VMBridgeManager *m_bridge;
    QImage m_frameBuffer;
    QTimer *m_pollTimer;
    bool m_active;
};
