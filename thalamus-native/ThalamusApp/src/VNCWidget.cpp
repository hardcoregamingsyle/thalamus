#include "VNCWidget.h"
#include <QPainter>
#include <QMouseEvent>
#include <QWheelEvent>
#include <QKeyEvent>
#include <QResizeEvent>
#include <QtEndian>
#include <cmath>

VNCWidget::VNCWidget(QWidget *parent)
    : QWidget(parent)
    , m_socket(new QTcpSocket(this))
    , m_port(5901)
    , m_rfbVersion(0)
    , m_connected(false)
    , m_initialized(false)
    , m_fbWidth(1024)
    , m_fbHeight(768)
    , m_bitsPerPixel(32)
    , m_bytesPerPixel(4)
    , m_depth(24)
    , m_expectedBytes(0)
    , m_mouseButtons(0)
    , m_scaleX(1.0)
    , m_scaleY(1.0)
    , m_updateTimer(new QTimer(this))
{
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    setMinimumSize(640, 480);
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);

    // Initialize black framebuffer
    m_framebuffer = QImage(m_fbWidth, m_fbHeight, QImage::Format_RGB32);
    m_framebuffer.fill(Qt::black);

    connect(m_socket, &QTcpSocket::connected, this, &VNCWidget::onSocketConnected);
    connect(m_socket, &QTcpSocket::disconnected, this, &VNCWidget::onSocketDisconnected);
    connect(m_socket, &QTcpSocket::readyRead, this, &VNCWidget::onSocketReadyRead);
    connect(m_socket, QOverload<QAbstractSocket::SocketError>::of(&QTcpSocket::error),
            this, &VNCWidget::onSocketError);

    // Request framebuffer updates every 100ms
    connect(m_updateTimer, &QTimer::timeout, this, [this]() {
        if (m_connected && m_initialized) {
            sendFramebufferUpdateRequest(true, 0, 0, m_fbWidth, m_fbHeight);
        }
    });
}

VNCWidget::~VNCWidget()
{
    disconnectFromHost();
}

void VNCWidget::connectToHost(const QString &host, quint16 port)
{
    m_host = host;
    m_port = port;
    m_connected = false;
    m_initialized = false;
    m_buffer.clear();
    m_expectedBytes = 0;

    m_socket->connectToHost(host, port);
}

void VNCWidget::disconnectFromHost()
{
    m_updateTimer->stop();
    m_connected = false;
    m_initialized = false;
    if (m_socket->state() != QAbstractSocket::UnconnectedState) {
        m_socket->disconnectFromHost();
    }
}

void VNCWidget::paintEvent(QPaintEvent *event)
{
    Q_UNUSED(event);
    QPainter painter(this);
    painter.setRenderHint(QPainter::SmoothPixmapTransform);

    // Calculate scaling
    m_scaleX = static_cast<double>(width()) / m_fbWidth;
    m_scaleY = static_cast<double>(height()) / m_fbHeight;
    double scale = std::min(m_scaleX, m_scaleY);

    int drawW = static_cast<int>(m_fbWidth * scale);
    int drawH = static_cast<int>(m_fbHeight * scale);
    int drawX = (width() - drawW) / 2;
    int drawY = (height() - drawH) / 2;

    // Dark background for letterboxing
    painter.fillRect(rect(), QColor(0x0d, 0x0d, 0x0d));

    // Draw framebuffer
    QRectF targetRect(drawX, drawY, drawW, drawH);
    painter.drawImage(targetRect, m_framebuffer);

    // Connection status overlay
    if (!m_connected) {
        QFont font = painter.font();
        font.setPointSize(14);
        painter.setFont(font);
        painter.setPen(QColor(0x88, 0x88, 0x88));
        painter.drawText(rect(), Qt::AlignCenter, "Disconnected\nClick \"Boot VM\" to start");
    }
}

void VNCWidget::mousePressEvent(QMouseEvent *event)
{
    if (!m_connected || !m_initialized) return;
    setFocus();

    quint8 button = 0;
    if (event->button() == Qt::LeftButton) button = 1;
    else if (event->button() == Qt::MiddleButton) button = 2;
    else if (event->button() == Qt::RightButton) button = 4;

    m_mouseButtons |= button;

    int x = event->position().x();
    int y = event->position().y();
    scalePoint(x, y);
    sendPointerEvent(m_mouseButtons, x, y);
}

void VNCWidget::mouseReleaseEvent(QMouseEvent *event)
{
    if (!m_connected || !m_initialized) return;

    quint8 button = 0;
    if (event->button() == Qt::LeftButton) button = 1;
    else if (event->button() == Qt::MiddleButton) button = 2;
    else if (event->button() == Qt::RightButton) button = 4;

    m_mouseButtons &= ~button;

    int x = event->position().x();
    int y = event->position().y();
    scalePoint(x, y);
    sendPointerEvent(m_mouseButtons, x, y);
}

void VNCWidget::mouseMoveEvent(QMouseEvent *event)
{
    if (!m_connected || !m_initialized) return;

    int x = event->position().x();
    int y = event->position().y();
    scalePoint(x, y);
    sendPointerEvent(m_mouseButtons, x, y);
}

void VNCWidget::wheelEvent(QWheelEvent *event)
{
    if (!m_connected || !m_initialized) return;

    quint8 button = 0;
    if (event->angleDelta().y() > 0) button = 8;  // Scroll up
    else if (event->angleDelta().y() < 0) button = 16; // Scroll down

    int x = event->position().x();
    int y = event->position().y();
    scalePoint(x, y);

    sendPointerEvent(button, x, y);
    sendPointerEvent(0, x, y);
}

void VNCWidget::keyPressEvent(QKeyEvent *event)
{
    if (!m_connected || !m_initialized) return;
    quint32 keysym = keysymFromQt(event->key());
    if (keysym) sendKeyEvent(true, keysym);
}

void VNCWidget::keyReleaseEvent(QKeyEvent *event)
{
    if (!m_connected || !m_initialized) return;
    quint32 keysym = keysymFromQt(event->key());
    if (keysym) sendKeyEvent(false, keysym);
}

void VNCWidget::resizeEvent(QResizeEvent *event)
{
    QWidget::resizeEvent(event);
    update();
}

void VNCWidget::onSocketConnected()
{
    sendHandshake();
}

void VNCWidget::onSocketDisconnected()
{
    m_connected = false;
    m_initialized = false;
    m_updateTimer->stop();
    update();
    emit disconnected();
}

void VNCWidget::onSocketReadyRead()
{
    m_buffer.append(m_socket->readAll());
    processServerMessage();
}

void VNCWidget::onSocketError(QAbstractSocket::SocketError error)
{
    Q_UNUSED(error);
    emit connectionError(m_socket->errorString());
}

void VNCWidget::sendHandshake()
{
    // RFB protocol: client sends version
    // Server sends version first in RFB 3.8
    // If we received the version already (in buffer), process it
    if (m_buffer.size() >= 12) {
        QByteArray versionStr = m_buffer.left(12);
        m_buffer = m_buffer.mid(12);

        if (versionStr.startsWith("RFB ")) {
            // Parse version
            m_rfbVersion = 38; // Assume 3.8
            // Respond with same version
            m_socket->write("RFB 003.008\n");
            sendSecurityHandshake();
        }
    }
}

void VNCWidget::sendSecurityHandshake()
{
    // Server sends number of security types
    if (m_buffer.size() < 1) return;
    quint8 numTypes = static_cast<quint8>(m_buffer[0]);
    m_buffer = m_buffer.mid(1);

    if (m_buffer.size() < numTypes) return;
    QByteArray secTypes = m_buffer.left(numTypes);
    m_buffer = m_buffer.mid(numTypes);

    // Choose first supported type (prefer 1 = None)
    for (int i = 0; i < secTypes.size(); i++) {
        quint8 type = static_cast<quint8>(secTypes[i]);
        if (type == 1) { // No auth
            m_socket->write(QByteArray(1, 1));
            sendClientInit();
            return;
        }
    }

    // If VNC auth (type 2) is available
    if (secTypes.contains(2) && !m_password.isEmpty()) {
        // Simplified — in a full impl, would handle challenge/response
        m_socket->write(QByteArray(1, 2));
    }
}

void VNCWidget::sendClientInit()
{
    // Shared flag: non-zero = shared
    char shared = 1;
    m_socket->write(&shared, 1);

    // Server will send framebuffer info now
    // Wait for ServerInit message (24 bytes header + name)
    m_expectedBytes = 24;
}

void VNCWidget::sendFramebufferUpdateRequest(bool incremental, int x, int y, int w, int h)
{
    QByteArray msg;
    msg.append(static_cast<char>(3)); // Message type: FramebufferUpdateRequest
    msg.append(incremental ? 1 : 0); // Incremental
    msg.append(static_cast<char>((x >> 8) & 0xFF));
    msg.append(static_cast<char>(x & 0xFF));
    msg.append(static_cast<char>((y >> 8) & 0xFF));
    msg.append(static_cast<char>(y & 0xFF));
    msg.append(static_cast<char>((w >> 8) & 0xFF));
    msg.append(static_cast<char>(w & 0xFF));
    msg.append(static_cast<char>((h >> 8) & 0xFF));
    msg.append(static_cast<char>(h & 0xFF));
    m_socket->write(msg);
}

void VNCWidget::sendKeyEvent(bool down, quint32 keysym)
{
    QByteArray msg;
    msg.append(static_cast<char>(4)); // Message type: KeyEvent
    msg.append(down ? 1 : 0);        // Down flag
    msg.append(QByteArray(2, 0));    // Padding
    msg.append(static_cast<char>((keysym >> 24) & 0xFF));
    msg.append(static_cast<char>((keysym >> 16) & 0xFF));
    msg.append(static_cast<char>((keysym >> 8) & 0xFF));
    msg.append(static_cast<char>(keysym & 0xFF));
    m_socket->write(msg);
}

void VNCWidget::sendPointerEvent(quint8 buttonMask, quint16 x, quint16 y)
{
    QByteArray msg;
    msg.append(static_cast<char>(5)); // Message type: PointerEvent
    msg.append(static_cast<char>(buttonMask));
    msg.append(static_cast<char>((x >> 8) & 0xFF));
    msg.append(static_cast<char>(x & 0xFF));
    msg.append(static_cast<char>((y >> 8) & 0xFF));
    msg.append(static_cast<char>(y & 0xFF));
    m_socket->write(msg);
}

void VNCWidget::sendSetEncodings()
{
    QByteArray msg;
    msg.append(static_cast<char>(2)); // Message type: SetEncodings
    msg.append(QByteArray(1, 0));    // Padding

    // Number of encodings (big-endian)
    quint16 numEncodings = 4;
    msg.append(static_cast<char>((numEncodings >> 8) & 0xFF));
    msg.append(static_cast<char>(numEncodings & 0xFF));

    // Encodings (big-endian signed 32-bit)
    // 0 = Raw, 1 = CopyRect, 2 = RRE, 16 = ZRLE, -239 = JPEG
    quint32 encodings[] = {0, 1, 16, static_cast<quint32>(-239)};
    for (int i = 0; i < numEncodings; i++) {
        msg.append(static_cast<char>((encodings[i] >> 24) & 0xFF));
        msg.append(static_cast<char>((encodings[i] >> 16) & 0xFF));
        msg.append(static_cast<char>((encodings[i] >> 8) & 0xFF));
        msg.append(static_cast<char>(encodings[i] & 0xFF));
    }
    m_socket->write(msg);
}

void VNCWidget::processServerMessage()
{
    while (true) {
        if (!m_initialized) {
            // Waiting for ServerInit
            if (m_buffer.size() < 24) return;

            int offset = 0;
            m_fbWidth = readU16(m_buffer, offset);
            m_fbHeight = readU16(m_buffer, offset);
            m_bitsPerPixel = static_cast<quint8>(m_buffer[offset]); offset++;
            m_depth = static_cast<quint8>(m_buffer[offset]); offset++;
            m_bytesPerPixel = (m_bitsPerPixel + 7) / 8;

            // Skip big/little endian, true color flags, colormap
            offset += 3;

            // Read pixel format: red/shift, green/shift, blue/shift
            offset += 12;

            // Name length and name
            quint32 nameLen = readU32(m_buffer, offset);
            offset += nameLen;

            m_buffer = m_buffer.mid(offset);
            m_initialized = true;
            m_connected = true;

            // Initialize framebuffer
            m_framebuffer = QImage(m_fbWidth, m_fbHeight, QImage::Format_RGB32);
            m_framebuffer.fill(Qt::black);

            // Send encodings and request initial update
            sendSetEncodings();
            sendFramebufferUpdateRequest(false, 0, 0, m_fbWidth, m_fbHeight);

            m_updateTimer->start(100);
            update();
            emit connected();
            continue;
        }

        // Process regular server messages
        if (m_buffer.size() < 1) return;

        quint8 msgType = static_cast<quint8>(m_buffer[0]);
        m_buffer = m_buffer.mid(1);

        switch (msgType) {
            case 0: // FramebufferUpdate
                if (m_buffer.size() < 3) return;
                processFramebufferUpdate(m_buffer);
                break;
            case 1: // SetColorMapEntries
                processSetColourMapEntries(m_buffer);
                break;
            case 2: // Bell
                processBell();
                break;
            case 3: // ServerCutText
                processServerCutText(m_buffer);
                break;
            default:
                // Unknown message type — skip
                return;
        }
    }
}

void VNCWidget::processFramebufferUpdate(const QByteArray &data)
{
    // Skip padding byte
    int offset = 1;

    // Number of rectangles
    quint16 numRects = readU16(data, offset);

    for (int r = 0; r < numRects; r++) {
        if (offset + 12 > data.size()) break;

        quint16 x = readU16(data, offset);
        quint16 y = readU16(data, offset);
        quint16 w = readU16(data, offset);
        quint16 h = readU16(data, offset);
        qint32 encoding = static_cast<qint32>(readU32(data, offset));

        switch (encoding) {
            case 0: { // Raw encoding
                int pixelBytes = w * h * m_bytesPerPixel;
                if (offset + pixelBytes > data.size()) return;

                for (int row = 0; row < h; row++) {
                    for (int col = 0; col < w; col++) {
                        quint8 rVal = data[offset + 2];
                        quint8 gVal = data[offset + 1];
                        quint8 bVal = data[offset];
                        if (x + col < m_fbWidth && y + row < m_fbHeight) {
                            m_framebuffer.setPixel(x + col, y + row,
                                qRgb(rVal, gVal, bVal));
                        }
                        offset += m_bytesPerPixel;
                    }
                }
                break;
            }
            case 1: { // CopyRect
                quint16 srcX = readU16(data, offset);
                quint16 srcY = readU16(data, offset);
                Q_UNUSED(srcX); Q_UNUSED(srcY);
                // Simplified copy rect
                break;
            }
            default:
                // Unknown encoding — skip
                return;
        }
    }

    m_buffer = data.mid(offset);
    update();
    emit framebufferUpdated();
}

void VNCWidget::processSetColourMapEntries(const QByteArray &data)
{
    Q_UNUSED(data);
    // Color maps are not typically used in 32-bit mode
}

void VNCWidget::processBell()
{
    // Play a system bell
    QApplication::beep();
}

void VNCWidget::processServerCutText(const QByteArray &data)
{
    int offset = 0;
    // Skip padding (3 bytes)
    offset += 3;
    // Read text length
    quint32 len = readU32(data, offset);
    Q_UNUSED(len);
    // Text follows — could copy to clipboard
}

quint16 VNCWidget::readU16(const QByteArray &data, int &offset)
{
    if (offset + 2 > data.size()) return 0;
    quint16 val = (static_cast<quint8>(data[offset]) << 8) |
                   static_cast<quint8>(data[offset + 1]);
    offset += 2;
    return val;
}

quint32 VNCWidget::readU32(const QByteArray &data, int &offset)
{
    if (offset + 4 > data.size()) return 0;
    quint32 val = (static_cast<quint32>(data[offset]) << 24) |
                  (static_cast<quint32>(data[offset + 1]) << 16) |
                  (static_cast<quint32>(data[offset + 2]) << 8) |
                   static_cast<quint32>(data[offset + 3]);
    offset += 4;
    return val;
}

void VNCWidget::readBytes(QByteArray &data, int &offset, int length)
{
    // Utility for reading raw bytes
    Q_UNUSED(data); Q_UNUSED(offset); Q_UNUSED(length);
}

void VNCWidget::scalePoint(int &x, int &y)
{
    // Inverse scaling from widget coordinates to framebuffer coordinates
    double scale = std::min(m_scaleX, m_scaleY);
    int drawW = static_cast<int>(m_fbWidth * scale);
    int drawH = static_cast<int>(m_fbHeight * scale);
    int drawX = (width() - drawW) / 2;
    int drawY = (height() - drawH) / 2;

    x = static_cast<int>((x - drawX) / scale);
    y = static_cast<int>((y - drawY) / scale);

    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x >= m_fbWidth) x = m_fbWidth - 1;
    if (y >= m_fbHeight) y = m_fbHeight - 1;
}

quint32 VNCWidget::keysymFromQt(int qtKey)
{
    // Map Qt key codes to X11 keysyms
    struct KeyMap { int qt; quint32 keysym; };
    static const KeyMap keyMap[] = {
        {Qt::Key_Backspace, 0xFF08}, {Qt::Key_Tab, 0xFF09},
        {Qt::Key_Return, 0xFF0D}, {Qt::Key_Escape, 0xFF1B},
        {Qt::Key_Delete, 0xFFFF}, {Qt::Key_Home, 0xFF50},
        {Qt::Key_Left, 0xFF51}, {Qt::Key_Up, 0xFF52},
        {Qt::Key_Right, 0xFF53}, {Qt::Key_Down, 0xFF54},
        {Qt::Key_PageUp, 0xFF55}, {Qt::Key_PageDown, 0xFF56},
        {Qt::Key_End, 0xFF57}, {Qt::Key_Insert, 0xFF63},
        {Qt::Key_F1, 0xFFBE}, {Qt::Key_F2, 0xFFBF},
        {Qt::Key_F3, 0xFFC0}, {Qt::Key_F4, 0xFFC1},
        {Qt::Key_F5, 0xFFC2}, {Qt::Key_F6, 0xFFC3},
        {Qt::Key_F7, 0xFFC4}, {Qt::Key_F8, 0xFFC5},
        {Qt::Key_F9, 0xFFC6}, {Qt::Key_F10, 0xFFC7},
        {Qt::Key_F11, 0xFFC8}, {Qt::Key_F12, 0xFFC9},
        {Qt::Key_Shift, 0xFFE1}, {Qt::Key_Control, 0xFFE3},
        {Qt::Key_Alt, 0xFFE9}, {Qt::Key_Meta, 0xFFE7},
        {Qt::Key_Space, 0x0020},
    };

    // Printable ASCII
    if (qtKey >= Qt::Key_Space && qtKey <= 0x7E) {
        return static_cast<quint32>(qtKey);
    }

    for (const auto &m : keyMap) {
        if (m.qt == qtKey) return m.keysym;
    }

    return 0;
}
