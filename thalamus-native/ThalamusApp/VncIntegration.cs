using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThalamusApp
{
    /// <summary>
    /// Pure-C# RFB 3.8 client — renders VM display into a WriteableBitmap in SandboxView.
    /// Handles Raw encoding (type 0), which QEMU always supports.
    /// </summary>
    public class EmbeddedVncClient
    {
        private readonly string _host;
        private readonly int    _port;
        private TcpClient?    _tcp;
        private NetworkStream? _stream;
        private int  _width, _height;
        private bool _connected;
        private CancellationTokenSource _cts = new();

        public event EventHandler<FrameUpdateEventArgs>? FrameUpdated;
        public event EventHandler<ConnectionEventArgs>?  ConnectionChanged;

        public class FrameUpdateEventArgs : EventArgs
        {
            public byte[] FrameData { get; set; } = Array.Empty<byte>();   // BGRA pixels for the dirty rect
            public int FullWidth  { get; set; }
            public int FullHeight { get; set; }
            public int X { get; set; }
            public int Y { get; set; }
            public int Width  { get; set; }
            public int Height { get; set; }
        }

        public class ConnectionEventArgs : EventArgs
        {
            public bool   IsConnected { get; set; }
            public string Message     { get; set; } = string.Empty;
        }

        public EmbeddedVncClient(string host, int port)
        {
            _host = host;
            _port = port;
        }

        public async Task ConnectAsync()
        {
            try
            {
                _tcp    = new TcpClient();
                await _tcp.ConnectAsync(_host, _port);
                _stream = _tcp.GetStream();

                await HandshakeAsync();

                _connected = true;
                ConnectionChanged?.Invoke(this, new ConnectionEventArgs { IsConnected = true, Message = "Connected" });

                _ = ReceiveLoopAsync();
            }
            catch (Exception ex)
            {
                _connected = false;
                ConnectionChanged?.Invoke(this, new ConnectionEventArgs { IsConnected = false, Message = ex.Message });
            }
        }

        // ── RFB 3.8 handshake ─────────────────────────────────────────────────

        private async Task HandshakeAsync()
        {
            // 1. Protocol version
            var serverVersion = await ReadExactAsync(12);
            await WriteAsync(Encoding.ASCII.GetBytes("RFB 003.008\n"));

            // 2. Security types
            var numTypes = (await ReadExactAsync(1))[0];
            if (numTypes == 0)
            {
                var errLen = ReadU32BE(await ReadExactAsync(4));
                var err    = Encoding.ASCII.GetString(await ReadExactAsync((int)errLen));
                throw new Exception($"Server refused connection: {err}");
            }

            var types = await ReadExactAsync(numTypes);
            // Select security type 1 (None) — works for local QEMU VNC
            await WriteAsync(new byte[] { 1 });

            // 3. Security result (4 bytes big-endian, 0 = OK)
            var secResult = ReadU32BE(await ReadExactAsync(4));
            if (secResult != 0)
                throw new Exception("VNC authentication failed");

            // 4. Client init — shared flag = 1 (allow multiple clients)
            await WriteAsync(new byte[] { 1 });

            // 5. Server init
            var serverInit = await ReadExactAsync(24);
            _width  = (int)ReadU16BE(serverInit, 0);
            _height = (int)ReadU16BE(serverInit, 2);

            // Skip pixel format (16 bytes) + name length + name (already have them from the 24-byte read above)
            // The server init is actually variable-length. We need to read the name too.
            var nameLen = (int)ReadU32BE(serverInit, 20);
            if (nameLen > 0)
                await ReadExactAsync(nameLen);

            // 6. Set pixel format to BGRA 32bpp — makes writing WriteableBitmap trivial
            //    Message type 0, padding 3 bytes, then PixelFormat struct (16 bytes)
            var setFmt = new byte[20];
            setFmt[0]  = 0;      // SetPixelFormat
            // pixel format: 32bpp, 24 depth, little-endian, true-colour
            setFmt[4]  = 32;     // bits-per-pixel
            setFmt[5]  = 24;     // depth
            setFmt[6]  = 0;      // big-endian = false  → little-endian
            setFmt[7]  = 1;      // true-colour
            // RGB max values
            setFmt[8]  = 0; setFmt[9]  = 255;  // red-max = 255
            setFmt[10] = 0; setFmt[11] = 255;  // green-max
            setFmt[12] = 0; setFmt[13] = 255;  // blue-max
            // Shifts (BGRA: B=0, G=8, R=16, A=24)
            setFmt[14] = 16;     // red-shift
            setFmt[15] = 8;      // green-shift
            setFmt[16] = 0;      // blue-shift
            await WriteAsync(setFmt);

            // 7. Set encodings: Raw only
            var setEnc = new byte[8];
            setEnc[0] = 2;       // SetEncodings
            // number of encodings = 1 (big-endian U16)
            setEnc[2] = 0; setEnc[3] = 1;
            // encoding type 0 = Raw (big-endian S32)
            setEnc[4] = 0; setEnc[5] = 0; setEnc[6] = 0; setEnc[7] = 0;
            await WriteAsync(setEnc);

            // 8. Request initial full framebuffer update
            await RequestUpdateAsync(incremental: false);
        }

        // ── Receive loop ──────────────────────────────────────────────────────

        private async Task ReceiveLoopAsync()
        {
            try
            {
                var token = _cts.Token;
                while (_connected && !token.IsCancellationRequested)
                {
                    var msgType = (await ReadExactAsync(1, token))[0];

                    switch (msgType)
                    {
                        case 0: // FramebufferUpdate
                            await ProcessFramebufferUpdateAsync(token);
                            await RequestUpdateAsync(incremental: true);
                            break;

                        case 2: // Bell — ignore
                            break;

                        case 3: // ServerCutText
                            await ReadExactAsync(3, token);   // padding
                            var textLen = (int)ReadU32BE(await ReadExactAsync(4, token));
                            if (textLen > 0) await ReadExactAsync(textLen, token);
                            break;

                        default:
                            // Unknown message — discard; protocol may be out of sync
                            Debug.WriteLine($"[VNC] Unknown server message: {msgType}");
                            break;
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                _connected = false;
                ConnectionChanged?.Invoke(this, new ConnectionEventArgs { IsConnected = false, Message = ex.Message });
            }
        }

        private async Task ProcessFramebufferUpdateAsync(CancellationToken token)
        {
            await ReadExactAsync(1, token);                                   // padding
            var numRects = (int)ReadU16BE(await ReadExactAsync(2, token), 0);

            for (int i = 0; i < numRects; i++)
            {
                var hdr = await ReadExactAsync(12, token);
                int x        = (int)ReadU16BE(hdr, 0);
                int y        = (int)ReadU16BE(hdr, 2);
                int w        = (int)ReadU16BE(hdr, 4);
                int h        = (int)ReadU16BE(hdr, 6);
                int encoding = (int)ReadS32BE(hdr, 8);

                if (encoding == 0) // Raw
                {
                    int bytes = w * h * 4;
                    if (bytes <= 0) continue;

                    var pixels = await ReadExactAsync(bytes, token);

                    FrameUpdated?.Invoke(this, new FrameUpdateEventArgs
                    {
                        FrameData = pixels,
                        FullWidth  = _width,
                        FullHeight = _height,
                        X = x, Y = y, Width = w, Height = h
                    });
                }
                else
                {
                    // Skip unrecognised encoding — we only requested Raw so this shouldn't happen
                    Debug.WriteLine($"[VNC] Unexpected encoding {encoding}, skipping rect");
                }
            }
        }

        private async Task RequestUpdateAsync(bool incremental)
        {
            var req = new byte[10];
            req[0] = 3;                          // FramebufferUpdateRequest
            req[1] = incremental ? (byte)1 : (byte)0;
            // X=0, Y=0
            req[2] = 0; req[3] = 0;
            req[4] = 0; req[5] = 0;
            // Width, Height (big-endian U16)
            req[6] = (byte)(_width  >> 8); req[7] = (byte)(_width  & 0xFF);
            req[8] = (byte)(_height >> 8); req[9] = (byte)(_height & 0xFF);
            await WriteAsync(req);
        }

        // ── Mouse / keyboard events ───────────────────────────────────────────

        public async Task SendMouseEventAsync(int x, int y, int buttonMask)
        {
            if (!_connected) return;
            var msg = new byte[6];
            msg[0] = 5;
            msg[1] = (byte)buttonMask;
            msg[2] = (byte)(x >> 8); msg[3] = (byte)(x & 0xFF);
            msg[4] = (byte)(y >> 8); msg[5] = (byte)(y & 0xFF);
            await WriteAsync(msg);
        }

        public async Task SendKeyEventAsync(uint keysym, bool down)
        {
            if (!_connected) return;
            var msg = new byte[8];
            msg[0] = 4;
            msg[1] = down ? (byte)1 : (byte)0;
            // padding 2 bytes
            msg[4] = (byte)(keysym >> 24);
            msg[5] = (byte)(keysym >> 16);
            msg[6] = (byte)(keysym >> 8);
            msg[7] = (byte)(keysym & 0xFF);
            await WriteAsync(msg);
        }

        // ── Disconnect ────────────────────────────────────────────────────────

        public void Disconnect()
        {
            _connected = false;
            _cts.Cancel();
            try { _stream?.Close(); } catch { }
            try { _tcp?.Close();    } catch { }
            ConnectionChanged?.Invoke(this, new ConnectionEventArgs { IsConnected = false, Message = "Disconnected" });
        }

        // ── IO helpers ────────────────────────────────────────────────────────

        private async Task<byte[]> ReadExactAsync(int count, CancellationToken token = default)
        {
            if (_stream == null) throw new InvalidOperationException("Not connected");
            var buf  = new byte[count];
            int read = 0;
            while (read < count)
            {
                int n = await _stream.ReadAsync(buf, read, count - read, token);
                if (n == 0) throw new IOException("VNC server closed the connection");
                read += n;
            }
            return buf;
        }

        private async Task WriteAsync(byte[] data)
        {
            if (_stream == null) throw new InvalidOperationException("Not connected");
            await _stream.WriteAsync(data, 0, data.Length);
            await _stream.FlushAsync();
        }

        // Big-endian read helpers
        private static uint   ReadU32BE(byte[] b, int o = 0) =>
            ((uint)b[o] << 24) | ((uint)b[o+1] << 16) | ((uint)b[o+2] << 8) | b[o+3];

        private static ushort ReadU16BE(byte[] b, int o = 0) =>
            (ushort)(((ushort)b[o] << 8) | b[o+1]);

        private static int ReadS32BE(byte[] b, int o = 0) =>
            (int)(((uint)b[o] << 24) | ((uint)b[o+1] << 16) | ((uint)b[o+2] << 8) | b[o+3]);
    }
}
