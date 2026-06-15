using System;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace ThalamusApp
{
    public partial class MainWindow : Window
    {
        private const string CONVEX_URL = "https://glad-ermine-937.convex.cloud";
        private const string APP_URL = "https://thalamus.aphantic.skinticals.com";
        // The QEMU bridge is a local WebSocket server on port 5900. The web app
        // connects to it directly (ws://localhost:5900) from inside WebView2.
        private const string BRIDGE_WS_PORT = "5900";

        private readonly string _installDir;
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

        public MainWindow()
        {
            InitializeComponent();
            _installDir = GetInstallDir();
            Loaded += MainWindow_Loaded;
            Closed += MainWindow_Closed;
        }

        private string GetInstallDir()
        {
            // The exe is in the install directory
            var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppDomain.CurrentDomain.BaseDirectory;

            // Check if bridge is here
            if (File.Exists(Path.Combine(exeDir, "thalamus-vm-bridge.exe")))
                return exeDir;

            // Check common install paths
            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Thalamus"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Thalamus"),
                exeDir,
            };

            foreach (var dir in candidates)
                if (File.Exists(Path.Combine(dir, "thalamus-vm-bridge.exe")))
                    return dir;

            return exeDir;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // Start bridge in background
            _ = Task.Run(StartBridge);

            // Initialize WebView2
            await InitWebView();
        }

        private void StartBridge()
        {
            try
            {
                var bridgeExe = Path.Combine(_installDir, "thalamus-vm-bridge.exe");
                if (!File.Exists(bridgeExe)) return;

                // Check if already running
                var processes = Process.GetProcessesByName("thalamus-vm-bridge");
                if (processes.Length > 0) return;

                var psi = new ProcessStartInfo(bridgeExe)
                {
                    WorkingDirectory = _installDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                Process.Start(psi);
            }
            catch { /* Non-critical */ }
        }

        private void LaunchVncViewer(string port)
        {
            try
            {
                var vncExe = Path.Combine(_installDir, "tvnviewer.exe");
                if (!File.Exists(vncExe)) return;
                Process.Start(new ProcessStartInfo(vncExe, $"localhost::{port}")
                {
                    UseShellExecute = false,
                    WorkingDirectory = _installDir,
                });
            }
            catch { /* Non-critical */ }
        }

        private async Task InitWebView()
        {
            try
            {
                UpdateStatus("Initializing WebView2...");

                // Set user data folder
                var userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Thalamus", "WebView2");

                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await WebView.EnsureCoreWebView2Async(env);

                UpdateStatus("Loading Thalamus AI...");
                WebView.Source = new Uri(APP_URL);
            }
            catch (Exception ex)
            {
                UpdateStatus($"Error: {ex.Message}");
                // Fallback: try to load anyway
                try { WebView.Source = new Uri(APP_URL); } catch { }
            }
        }

        private void UpdateStatus(string msg)
        {
            Dispatcher.Invoke(() => LoadingStatus.Text = msg);
        }

        private void WebView_CoreWebView2InitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess) return;

            // Configure WebView2
            WebView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            WebView.CoreWebView2.Settings.IsZoomControlEnabled = false;
            WebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;

            // Allow DevTools in debug
#if DEBUG
            WebView.CoreWebView2.Settings.AreDevToolsEnabled = true;
#else
            WebView.CoreWebView2.Settings.AreDevToolsEnabled = false;
#endif

            // Handle new window requests (open in default browser)
            WebView.CoreWebView2.NewWindowRequested += (s, args) =>
            {
                args.Handled = true;
                Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
            };

            // Inject the native bridge object. This advertises the native runtime
            // to the web app and exposes window-control + VNC helpers. VM control
            // itself happens over a direct WebSocket to ws://localhost:5900, which
            // the web app opens on its own.
            WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"
                window.ThalamusNative = {
                    bridgeWsUrl: 'ws://localhost:" + BRIDGE_WS_PORT + @"',
                    installDir: '" + _installDir.Replace("\\", "\\\\") + @"',
                    version: '1.0.0',
                    runtime: 'csharp-dotnet8-wpf',
                    platform: 'windows',
                    isNative: true,
                    isElectron: false,

                    // Convenience WebSocket factory for the VM bridge.
                    connectBridge() {
                        return new WebSocket(this.bridgeWsUrl);
                    },

                    minimize() { window.chrome.webview.postMessage({ type: 'minimize' }); },
                    maximize() { window.chrome.webview.postMessage({ type: 'maximize' }); },
                    close() { window.chrome.webview.postMessage({ type: 'close' }); },
                    openExternal(url) { window.chrome.webview.postMessage({ type: 'openExternal', url }); },
                    launchVnc(port) { window.chrome.webview.postMessage({ type: 'launchVnc', port: port }); },
                };
            ");

            // Handle messages from web app
            WebView.CoreWebView2.WebMessageReceived += (s, args) =>
            {
                try
                {
                    var msg = JsonSerializer.Deserialize<JsonElement>(args.WebMessageAsJson);
                    var type = msg.GetProperty("type").GetString();
                    switch (type)
                    {
                        case "minimize": Dispatcher.Invoke(Minimize); break;
                        case "maximize": Dispatcher.Invoke(ToggleMaximize); break;
                        case "close": Dispatcher.Invoke(Close); break;
                        case "openExternal":
                            var url = msg.GetProperty("url").GetString();
                            if (url != null)
                                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                            break;
                        case "launchVnc":
                            var port = msg.TryGetProperty("port", out var p) ? p.ToString() : "5901";
                            LaunchVncViewer(port);
                            break;
                    }
                }
                catch { }
            };
        }

        private void WebView_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
        {
            // Allow navigation to our app and Convex
            if (!e.Uri.StartsWith(APP_URL) && !e.Uri.StartsWith(CONVEX_URL) &&
                !e.Uri.StartsWith("https://glad-ermine") && !e.Uri.StartsWith("data:"))
            {
                // External link — open in browser
                if (e.Uri.StartsWith("http://") || e.Uri.StartsWith("https://"))
                {
                    e.Cancel = true;
                    Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
                }
            }
        }

        private void WebView_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                LoadingOverlay.Visibility = Visibility.Collapsed;
            });
        }

        // ── Window Controls ──
        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ClickCount == 2)
                ToggleMaximize();
            else
                DragMove();
        }

        private void MinimizeBtn_Click(object sender, RoutedEventArgs e) => Minimize();
        private void MaximizeBtn_Click(object sender, RoutedEventArgs e) => ToggleMaximize();
        private void CloseBtn_Click(object sender, RoutedEventArgs e) => Close();

        private void Minimize() => WindowState = WindowState.Minimized;

        private void ToggleMaximize()
        {
            WindowState = WindowState == WindowState.Maximized
                ? WindowState.Normal
                : WindowState.Maximized;
        }

        private void Window_StateChanged(object? sender, EventArgs e)
        {
            MaximizeBtn.Content = WindowState == WindowState.Maximized ? "❐" : "□";
        }

        private void MainWindow_Closed(object? sender, EventArgs e)
        {
            _http.Dispose();
        }
    }
}
