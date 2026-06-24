using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace ThalamusApp
{
    public partial class SandboxView : UserControl
    {
        private QemuBridgeManager _bridge;
        private EmbeddedVncClient _vnc;
        private WriteableBitmap  _vncBitmap;

        private string _selectedOsId   = null;
        private Button _selectedOsBtn  = null;
        private string _currentVmId    = null;
        private int    _currentVncPort = 0;

        // OS definitions — (id, display name, category)
        private static readonly (string id, string name, string cat)[] _osList =
        {
            ("windows-11",  "Windows 11 Pro (24H2)",    "windows"),
            ("windows-10",  "Windows 10 Pro (22H2)",    "windows"),
            ("macos-18",    "macOS 15 Sequoia",          "macos"),
            ("macos-17",    "macOS 14 Sonoma",           "macos"),
            ("macos-16",    "macOS 13 Ventura",          "macos"),
            ("macos-15",    "macOS 12 Monterey",         "macos"),
            ("macos-14",    "macOS 11 Big Sur",          "macos"),
            ("android-14",  "Android 14 x86_64",         "android"),
            ("android-13",  "Android 13 x86_64",         "android"),
            ("ubuntu-24",   "Ubuntu 24.04 LTS",          "linux"),
            ("debian-12",   "Debian 12 Bookworm",        "linux"),
            ("kali-2024",   "Kali Linux 2024.4",         "linux"),
        };

        public SandboxView()
        {
            InitializeComponent();
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            var installDir = ResolveInstallDir();
            _bridge = new QemuBridgeManager(installDir);

            RamSlider.ValueChanged   += (_, _) => RamLabel.Text   = $"{(int)RamSlider.Value} MB";
            CoresSlider.ValueChanged += (_, _) => CoresLabel.Text = $"{(int)CoresSlider.Value} Cores";

            BuildOsList();
            AppendConsole("VM Sandbox ready. Select an OS and click Boot VM.");
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            _vnc?.Disconnect();
        }

        // ── Build OS selection buttons ────────────────────────────────────────

        private void BuildOsList()
        {
            foreach (var (id, name, cat) in _osList)
            {
                var btn = new Button
                {
                    Content = name,
                    Tag     = id,
                    Style   = (Style)FindResource("OsItem"),
                };
                btn.Click += OsButton_Click;

                switch (cat)
                {
                    case "windows": OsWindows.Children.Add(btn); break;
                    case "macos":   OsMacos.Children.Add(btn);   break;
                    case "android": OsAndroid.Children.Add(btn); break;
                    default:        OsLinux.Children.Add(btn);   break;
                }
            }
        }

        private void OsButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn) return;

            // Reset previous selection
            if (_selectedOsBtn != null)
                _selectedOsBtn.Style = (Style)FindResource("OsItem");

            _selectedOsBtn = btn;
            _selectedOsId  = btn.Tag as string;
            btn.Style = (Style)FindResource("OsItemActive");

            DisplayText.Text = $"Ready to boot: {btn.Content}";
            IsoHint.Text     = "";
        }

        // ── Boot ──────────────────────────────────────────────────────────────

        private async void BootButton_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedOsId == null)
            {
                AppendConsole("⚠  Select an operating system first.");
                return;
            }

            BootButton.IsEnabled = false;
            SetVmStatus("Booting…", Colors.Goldenrod);
            DisplayText.Text = $"Starting {_selectedOsBtn?.Content}…";
            IsoHint.Text     = "";

            AppendConsole($"Booting {_selectedOsId} | RAM {(int)RamSlider.Value} MB | {(int)CoresSlider.Value} cores");

            var result = await _bridge.BootVMAsync(_selectedOsId, (int)RamSlider.Value, (int)CoresSlider.Value);

            if (result.Success)
            {
                _currentVmId    = result.VmId;
                _currentVncPort = result.VncPort;

                SetVmStatus($"Running  ·  VNC localhost:{result.VncPort}", Colors.LightGreen);
                VncPortText.Text     = $"localhost:{result.VncPort}";
                DisplayText.Text     = $"VM running on VNC port {result.VncPort}";
                StopButton.IsEnabled = true;
                VncButton.IsEnabled  = true;

                AppendConsole($"✓ VM started. VNC port: {result.VncPort}");

                // Auto-connect embedded VNC after a short delay (let QEMU initialise)
                _ = Task.Run(async () =>
                {
                    await Task.Delay(3000);
                    Dispatcher.Invoke(ConnectEmbeddedVnc);
                });
            }
            else
            {
                SetVmStatus("Boot failed", Colors.Salmon);
                DisplayText.Text = result.Error ?? "Unknown error";

                if (result.IsoNeeded != null)
                {
                    IsoHint.Text = $"ISO not found: {result.IsoNeeded}\n\nPlace the ISO in the isos\\ folder inside your Thalamus install directory.";
                    AppendConsole($"✗ ISO missing: {result.IsoNeeded}");
                }
                else
                {
                    AppendConsole($"✗ {result.Error}");
                }

                BootButton.IsEnabled = true;
            }
        }

        // ── Stop ──────────────────────────────────────────────────────────────

        private async void StopButton_Click(object sender, RoutedEventArgs e)
        {
            if (_currentVmId == null) return;

            StopButton.IsEnabled = false;
            SetVmStatus("Stopping…", Colors.Goldenrod);

            _vnc?.Disconnect();
            _vnc = null;
            VncFrame.Visibility = Visibility.Collapsed;
            DisplayPlaceholder.Visibility = Visibility.Visible;

            var ok = await _bridge.StopVMAsync(_currentVmId);

            if (ok)
            {
                _currentVmId    = null;
                _currentVncPort = 0;
                VncPortText.Text     = "";
                VncButton.IsEnabled  = false;
                DisplayText.Text     = "Select an OS and click Boot VM to start";
                SetVmStatus("No VM running", Colors.Gray);
                AppendConsole("✓ VM stopped.");
            }
            else
            {
                SetVmStatus("Error stopping VM", Colors.Salmon);
                StopButton.IsEnabled = true;
                AppendConsole("✗ Failed to stop VM.");
            }

            BootButton.IsEnabled = true;
        }

        // ── Embedded VNC ──────────────────────────────────────────────────────

        private void ConnectEmbeddedVnc()
        {
            try
            {
                _vnc = new EmbeddedVncClient("localhost", _currentVncPort);

                _vnc.FrameUpdated += OnVncFrameUpdated;
                _vnc.ConnectionChanged += OnVncConnectionChanged;

                _ = _vnc.ConnectAsync();
                AppendConsole($"VNC client connecting to localhost:{_currentVncPort}…");
            }
            catch (Exception ex)
            {
                AppendConsole($"Embedded VNC error: {ex.Message}");
            }
        }

        private void OnVncConnectionChanged(object sender, EmbeddedVncClient.ConnectionEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                AppendConsole(e.IsConnected ? "✓ VNC connected." : $"VNC disconnected: {e.Message}");
                if (!e.IsConnected)
                {
                    VncFrame.Visibility           = Visibility.Collapsed;
                    DisplayPlaceholder.Visibility = Visibility.Visible;
                }
            });
        }

        private void OnVncFrameUpdated(object sender, EmbeddedVncClient.FrameUpdateEventArgs e)
        {
            Dispatcher.Invoke(() =>
            {
                // Initialise WriteableBitmap at VNC server's resolution
                if (_vncBitmap == null || _vncBitmap.PixelWidth != e.FullWidth || _vncBitmap.PixelHeight != e.FullHeight)
                {
                    _vncBitmap = new WriteableBitmap(
                        e.FullWidth, e.FullHeight, 96, 96, PixelFormats.Bgr32, null);
                    VncFrame.Source = _vncBitmap;
                }

                // Write rect into bitmap
                var rect = new Int32Rect(e.X, e.Y, e.Width, e.Height);
                _vncBitmap.WritePixels(rect, e.FrameData, e.Width * 4, 0);

                // Show image, hide placeholder
                if (VncFrame.Visibility != Visibility.Visible)
                {
                    VncFrame.Visibility           = Visibility.Visible;
                    DisplayPlaceholder.Visibility = Visibility.Collapsed;
                }
            });
        }

        // Launch external TightVNC viewer as fallback / side-by-side
        private void LaunchVNCButton_Click(object sender, RoutedEventArgs e)
        {
            if (_currentVncPort == 0) return;

            var installDir = ResolveInstallDir();
            var tvn = Path.Combine(installDir, "tvnviewer.exe");

            if (!File.Exists(tvn))
            {
                AppendConsole("tvnviewer.exe not found in install directory.");
                return;
            }

            try
            {
                Process.Start(new ProcessStartInfo(tvn, $"localhost::{_currentVncPort}")
                {
                    UseShellExecute = false,
                    WorkingDirectory = installDir,
                });
                AppendConsole($"Launched TightVNC viewer → localhost:{_currentVncPort}");
            }
            catch (Exception ex)
            {
                AppendConsole($"VNC launch error: {ex.Message}");
            }
        }

        // ── Refresh ───────────────────────────────────────────────────────────

        private void RefreshButton_Click(object sender, RoutedEventArgs e)
        {
            var vms = _bridge.ListActiveVMs();
            AppendConsole($"── Active VMs: {vms.Count} ──");

            foreach (var vm in vms)
                AppendConsole($"  {vm.OS}  VNC:{vm.VncPort}  RAM:{vm.RAM}MB  Cores:{vm.Cores}");

            var disk = _bridge.GetDiskInfo();
            if (disk.TryGetValue("totalSize", out var sz))
                AppendConsole($"  Disk images: {(long)sz / 1_048_576} MB");
        }

        // ── Console ───────────────────────────────────────────────────────────

        private void SendCommand_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(CommandInput.Text)) return;
            var cmd = CommandInput.Text.Trim();
            CommandInput.Clear();
            AppendConsole($"> {cmd}");
            // QEMU monitor / serial would be wired here
        }

        private void CommandInput_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
        {
            if (e.Key == System.Windows.Input.Key.Return)
            {
                SendCommand_Click(null, null);
                e.Handled = true;
            }
        }

        private void AppendConsole(string line)
        {
            Dispatcher.Invoke(() =>
            {
                ConsoleOutput.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}\n");
                ConsoleScroll.ScrollToBottom();
            });
        }

        // ── Helpers ───────────────────────────────────────────────────────────

        private void SetVmStatus(string text, Color dotColor)
        {
            VmStatusText.Text = text;
            VmStatusDot.Fill  = new SolidColorBrush(dotColor);
        }

        private static string ResolveInstallDir()
        {
            var exe = Path.GetDirectoryName(Environment.ProcessPath)
                      ?? AppDomain.CurrentDomain.BaseDirectory;

            if (File.Exists(Path.Combine(exe, "thalamus-vm-bridge.exe")))
                return exe;

            var local = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Thalamus");
            if (Directory.Exists(local)) return local;

            return exe;
        }
    }
}
