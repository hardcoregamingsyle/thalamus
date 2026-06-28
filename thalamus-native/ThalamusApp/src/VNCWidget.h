#ifndef VNCWIDGET_H
#define VNCWIDGET_H

#include <QWidget>
#include <QTcpSocket>
#include <QImage>
#include <QTimer>
#include <QPoint>
#include <QMap>

/**
 * @brief Embedded VNC client widget for displaying VM screens.
 *
 * Implements the RFB 3.8 protocol to connect to QEMU's VNC server.
 * Supports: framebuffer updates, keyboard input, mouse events,
 * copyrect, and tight/raw encoding.
 */
class VNCWidget : public QWidget
{
    Q_OBJECT

public:
    explicit VNCWidget(QWidget *parent = nullptr);
    ~VNCWidget();

    /// Connect to VNC server
    void connectToHost(const QString &host, quint16 port);

    /// Disconnect
    void disconnectFromHost();

    /// Check if connected
    bool isConnected() const { return m_connected; }

    /// Get framebuffer width
    int fbWidth() const { return m_fbWidth; }

    /// Get framebuffer height
    int fbHeight() const { return m_fbHeight; }

    /// Set a password for VNC auth
    void setPassword(const QString &password) { m_password = password; }

signals:
    void connected();
    void disconnected();
    void framebufferUpdated();
    void connectionError(const QString &error);

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void keyReleaseEvent(QKeyEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;

private slots:
    void onSocketConnected();
    void onSocketDisconnected();
    void onSocketReadyRead();
    void onSocketError(QAbstractSocket::SocketError error);

private:
    // RFB protocol methods
    void sendHandshake();
    void sendSecurityHandshake();
    void sendClientInit();
    void sendFramebufferUpdateRequest(bool incremental, int x, int y, int w, int h);
    void sendKeyEvent(bool down, quint32 keySym);
    void sendPointerEvent(quint8 buttonMask, quint16 x, quint16 y);
    void sendSetEncodings();

    // Message parsing
    void processServerMessage();
    void processFramebufferUpdate(const QByteArray &data);
    void processSetColourMapEntries(const QByteArray &data);
    void processBell();
    void processServerCutText(const QByteArray &data);

    // Helper
    quint16 readU16(const QByteArray &data, int &offset);
    quint32 readU32(const QByteArray &data, int &offset);
    void readBytes(QByteArray &data, int &offset, int length);
    void scalePoint(int &x, int &y);

    QTcpSocket *m_socket;
    QString m_host;
    quint16 m_port;
    QString m_password;

    // RFB state
    int m_rfbVersion;
    bool m_connected;
    bool m_initialized;

    // Framebuffer
    QImage m_framebuffer;
    int m_fbWidth;
    int m_fbHeight;
    int m_bitsPerPixel;
    int m_bytesPerPixel;
    int m_depth;

    // Input buffer
    QByteArray m_buffer;
    int m_expectedBytes;

    // Mouse state
    QPoint m_mousePos;
    quint8 m_mouseButtons;

    // Track scaling
    double m_scaleX;
    double m_scaleY;

    // Frame timer
    QTimer *m_updateTimer;

    // KeySym mapping
    static quint32 keysymFromQt(int qtKey);
};

#endif // VNCWIDGET_H
