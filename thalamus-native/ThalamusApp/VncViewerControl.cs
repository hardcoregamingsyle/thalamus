// VncViewerControl.cs — retained for external TightVNC launcher compatibility.
// The embedded VNC client (EmbeddedVncClient) lives in VncIntegration.cs.

using System.Diagnostics;
using System.IO;

namespace ThalamusApp
{
    /// <summary>Launches the external TightVNC viewer process.</summary>
    public static class ExternalVncViewer
    {
        public static Process? Launch(string installDir, string host, int port)
        {
            var tvn = Path.Combine(installDir, "tvnviewer.exe");
            if (!File.Exists(tvn)) return null;

            return Process.Start(new ProcessStartInfo(tvn, $"{host}::{port}")
            {
                UseShellExecute  = false,
                WorkingDirectory = installDir,
            });
        }
    }
}
