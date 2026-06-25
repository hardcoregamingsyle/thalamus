using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Shapes = System.Windows.Shapes;
using Microsoft.Win32;

namespace ThalamusInstaller
{
    public partial class InstallerWindow : Window
    {
        // ── Download URLs ──────────────────────────────────────────────────────
        private const string URL_APP    = "https://github.com/hardcoregamingsyle/thalamus/releases/download/thalamus-native-v1.0.0/Thalamus.exe";
        private const string URL_BRIDGE = "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v3.5.0/thalamus-vm-bridge-v3.5.0.exe";
        private const string URL_QEMU   = "https://qemu.weilnetz.de/w64/2024/qemu-w64-setup-20241119.exe";
        private const string URL_VNC    = "https://github.com/nicowillis/tightvnc-portable/releases/download/v2.8.85/tvnviewer.exe";
        private const string URL_ARIA2  = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";

        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(30) };
        private string _installDir;
        private int    _page = 0;
        private CancellationTokenSource _installCts;

        // Step display models
        private record StepItem(string Label, TextBlock StatusEl);
        private readonly List<StepItem> _steps = new();

        public InstallerWindow()
        {
            InitializeComponent();
            _installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Thalamus");

            Loaded += OnLoaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            InstallPathBox.Text = _installDir;
            BuildStepList();
            UpdateDiskSpaceLabel();
            UpdateTotalSize();

            ChkQemu.Checked   += (_, _) => UpdateTotalSize();
            ChkQemu.Unchecked += (_, _) => UpdateTotalSize();
            ChkVnc.Checked    += (_, _) => UpdateTotalSize();
            ChkVnc.Unchecked  += (_, _) => UpdateTotalSize();
            ChkAria2.Checked  += (_, _) => UpdateTotalSize();
            ChkAria2.Unchecked += (_, _) => UpdateTotalSize();
        }

        // ── Step sidebar ─────────────────────────────────────────────────────

        private void BuildStepList()
        {
            _steps.Clear();
            StepList.Children.Clear();

            var labels = new[] { "Welcome", "Location", "Components", "Installing", "Done" };
            for (int i = 0; i < labels.Length; i++)
            {
                var row = new Grid { Margin = new Thickness(0, 0, 0, 8) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) });
                row.ColumnDefinitions.Add(new ColumnDefinition());

                var dot = new Shapes.Ellipse
                {
                    Width  = 8, Height = 8,
                    Fill   = i == 0
                        ? new SolidColorBrush(Color.FromRgb(59, 130, 246))
                        : new SolidColorBrush(Color.FromRgb(51, 65, 85)),
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 0, 0),
                };
                Grid.SetColumn(dot, 0);

                var lbl = new TextBlock
                {
                    Text       = labels[i],
                    FontSize   = 12,
                    Foreground = i == 0
                        ? new SolidColorBrush(Color.FromRgb(226, 232, 240))
                        : new SolidColorBrush(Color.FromRgb(100, 116, 139)),
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(10, 0, 0, 0),
                };
                Grid.SetColumn(lbl, 1);

                row.Children.Add(dot);
                row.Children.Add(lbl);
                StepList.Children.Add(row);

                _steps.Add(new StepItem(labels[i], lbl));
            }
        }

        private void HighlightStep(int index)
        {
            for (int i = 0; i < _steps.Count; i++)
            {
                bool active   = i == index;
                bool complete = i < index;

                var row  = (Grid)StepList.Children[i];
                var dot  = (Shapes.Ellipse)row.Children[0];
                var text = (TextBlock)row.Children[1];

                dot.Fill = active   ? new SolidColorBrush(Color.FromRgb(59, 130, 246))
                         : complete ? new SolidColorBrush(Color.FromRgb(16, 185, 129))
                                    : new SolidColorBrush(Color.FromRgb(51, 65, 85));

                text.Foreground = active || complete
                    ? new SolidColorBrush(Color.FromRgb(226, 232, 240))
                    : new SolidColorBrush(Color.FromRgb(100, 116, 139));

                text.FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal;
            }
        }

        // ── Page navigation ───────────────────────────────────────────────────

        private void ShowPage(int p)
        {
            _page = p;
            PageWelcome.Visibility    = p == 0 ? Visibility.Visible : Visibility.Collapsed;
            PageLocation.Visibility   = p == 1 ? Visibility.Visible : Visibility.Collapsed;
            PageComponents.Visibility = p == 2 ? Visibility.Visible : Visibility.Collapsed;
            PageInstalling.Visibility = p == 3 ? Visibility.Visible : Visibility.Collapsed;
            PageDone.Visibility       = p == 4 ? Visibility.Visible : Visibility.Collapsed;
            PageError.Visibility      = p == 5 ? Visibility.Visible : Visibility.Collapsed;

            HighlightStep(Math.Min(p, _steps.Count - 1));
        }

        // ── Welcome ───────────────────────────────────────────────────────────

        private void Welcome_Next(object sender, RoutedEventArgs e) => ShowPage(1);

        // ── Location ─────────────────────────────────────────────────────────

        private void BrowseFolder_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new OpenFolderDialog
            {
                Title            = "Choose Thalamus AI installation folder",
                InitialDirectory = InstallPathBox.Text,
            };
            if (dlg.ShowDialog() == true)
            {
                InstallPathBox.Text = dlg.FolderName;
                _installDir         = dlg.FolderName;
                UpdateDiskSpaceLabel();
            }
        }

        private void UpdateDiskSpaceLabel()
        {
            try
            {
                var root = Path.GetPathRoot(InstallPathBox.Text) ?? "C:\\";
                var info = new DriveInfo(root);
                var freeGb = info.AvailableFreeSpace / 1_073_741_824.0;
                DiskSpaceLabel.Text = $"Free space on {root.TrimEnd('\\')}:  {freeGb:F1} GB available";
            }
            catch
            {
                DiskSpaceLabel.Text = "";
            }
        }

        private void Location_Back(object sender, RoutedEventArgs e) => ShowPage(0);
        private void Location_Next(object sender, RoutedEventArgs e)
        {
            _installDir = InstallPathBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(_installDir))
            {
                InstallPathBox.BorderBrush = new SolidColorBrush(Color.FromRgb(239, 68, 68));
                return;
            }
            ShowPage(2);
        }

        // ── Components ────────────────────────────────────────────────────────

        private void UpdateTotalSize()
        {
            int mb = 33; // app + bridge
            if (ChkQemu.IsChecked  == true) mb += 130;
            if (ChkVnc.IsChecked   == true) mb += 1;
            if (ChkAria2.IsChecked == true) mb += 3;
            TotalSizeLabel.Text = $"Estimated download: ~{mb} MB";
        }

        private void Components_Back(object sender, RoutedEventArgs e) => ShowPage(1);

        private void Components_Install(object sender, RoutedEventArgs e)
        {
            ShowPage(3);
            _installCts = new CancellationTokenSource();
            _ = RunInstallAsync(_installCts.Token);
        }

        // ── Installation ──────────────────────────────────────────────────────

        private async Task RunInstallAsync(CancellationToken ct)
        {
            try
            {
                Log("Starting installation…");
                SetProgress(0, "Creating directories…");

                // Create directories
                Directory.CreateDirectory(_installDir);
                Directory.CreateDirectory(Path.Combine(_installDir, "isos"));
                Directory.CreateDirectory(Path.Combine(_installDir, "disks"));

                int totalSteps = 2
                    + (ChkQemu.IsChecked  == true ? 1 : 0)
                    + (ChkVnc.IsChecked   == true ? 1 : 0)
                    + (ChkAria2.IsChecked == true ? 1 : 0);
                int done = 0;

                // 1. Download desktop app
                SetProgress((int)(done * 100.0 / totalSteps), "Downloading Thalamus AI app…");
                await DownloadAsync(URL_APP, Path.Combine(_installDir, "Thalamus.exe"), ct,
                    pct => SetProgress((int)((done + pct / 100.0) * 100.0 / totalSteps),
                        $"Downloading app… {pct}%"));
                Log("✓ Thalamus.exe downloaded.");
                done++;

                // 2. Download VM bridge
                SetProgress((int)(done * 100.0 / totalSteps), "Downloading VM Bridge…");
                await DownloadAsync(URL_BRIDGE, Path.Combine(_installDir, "thalamus-vm-bridge.exe"), ct,
                    pct => SetProgress((int)((done + pct / 100.0) * 100.0 / totalSteps),
                        $"Downloading bridge… {pct}%"));
                Log("✓ VM Bridge downloaded.");
                done++;

                // 3. QEMU (optional) — run official installer silently
                if (ChkQemu.IsChecked == true)
                {
                    SetProgress((int)(done * 100.0 / totalSteps), "Downloading QEMU installer…");
                    var qemuInstaller = Path.Combine(Path.GetTempPath(), "qemu-setup.exe");
                    await DownloadAsync(URL_QEMU, qemuInstaller, ct,
                        pct => SetProgress((int)((done + pct / 100.0) * 100.0 / totalSteps),
                            $"Downloading QEMU… {pct}%"));
                    Log("✓ QEMU installer downloaded. Running silently…");
                    await RunProcessAsync(qemuInstaller, "/S", 300, ct);
                    try { File.Delete(qemuInstaller); } catch { }
                    Log("✓ QEMU installed.");
                    done++;
                }

                // 4. TightVNC viewer
                if (ChkVnc.IsChecked == true)
                {
                    SetProgress((int)(done * 100.0 / totalSteps), "Downloading VNC viewer…");
                    await DownloadAsync(URL_VNC, Path.Combine(_installDir, "tvnviewer.exe"), ct,
                        pct => SetProgress((int)((done + pct / 100.0) * 100.0 / totalSteps),
                            $"Downloading VNC viewer… {pct}%"));
                    Log("✓ TightVNC viewer downloaded.");
                    done++;
                }

                // 5. aria2
                if (ChkAria2.IsChecked == true)
                {
                    SetProgress((int)(done * 100.0 / totalSteps), "Downloading aria2…");
                    var zipPath = Path.Combine(Path.GetTempPath(), "aria2.zip");
                    await DownloadAsync(URL_ARIA2, zipPath, ct,
                        pct => SetProgress((int)((done + pct / 100.0) * 100.0 / totalSteps),
                            $"Downloading aria2… {pct}%"));
                    ExtractAria2(zipPath, _installDir);
                    try { File.Delete(zipPath); } catch { }
                    Log("✓ aria2 extracted.");
                    done++;
                }

                SetProgress(95, "Registering with Windows…");

                // Write install.json
                var installInfo = new
                {
                    version     = "1.0.0",
                    installDir  = _installDir,
                    installedAt = DateTime.UtcNow.ToString("o"),
                };
                await File.WriteAllTextAsync(
                    Path.Combine(_installDir, "install.json"),
                    JsonSerializer.Serialize(installInfo, new JsonSerializerOptions { WriteIndented = true }));

                // Desktop shortcut
                if (ChkDesktop.IsChecked == true)
                    CreateShortcut(
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Thalamus AI.lnk"),
                        Path.Combine(_installDir, "Thalamus.exe"));

                // Start Menu shortcut
                if (ChkStartMenu.IsChecked == true)
                {
                    var startDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                        "Programs", "Thalamus AI");
                    Directory.CreateDirectory(startDir);
                    CreateShortcut(
                        Path.Combine(startDir, "Thalamus AI.lnk"),
                        Path.Combine(_installDir, "Thalamus.exe"));
                }

                // Registry — Add/Remove Programs
                RegisterWithArp(_installDir);

                // URI scheme
                if (ChkUriScheme.IsChecked == true)
                    RegisterUriScheme(_installDir);

                // Bridge startup
                if (ChkBridge.IsChecked == true)
                    RegisterBridgeStartup(_installDir);

                SetProgress(100, "Done!");
                Log("✓ Installation complete.");

                await Task.Delay(600);
                Dispatcher.Invoke(() => ShowPage(4));
            }
            catch (OperationCanceledException)
            {
                Dispatcher.Invoke(() =>
                {
                    ErrorDetail.Text = "Installation was cancelled.";
                    ShowPage(5);
                });
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    ErrorDetail.Text = ex.Message;
                    ShowPage(5);
                });
            }
        }

        // ── Download helper ───────────────────────────────────────────────────

        private async Task DownloadAsync(string url, string dest, CancellationToken ct, Action<int> onProgress = null)
        {
            using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();

            var total = response.Content.Headers.ContentLength ?? 0;

            await using var src  = await response.Content.ReadAsStreamAsync(ct);
            await using var file = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);

            var buf      = new byte[81920];
            long read    = 0;
            int  lastPct = -1;
            int  n;

            var sw = Stopwatch.StartNew();
            long lastBytes = 0;

            while ((n = await src.ReadAsync(buf, ct)) != 0)
            {
                await file.WriteAsync(buf.AsMemory(0, n), ct);
                read += n;

                if (total > 0)
                {
                    int pct = (int)(read * 100 / total);
                    if (pct != lastPct)
                    {
                        lastPct = pct;
                        onProgress?.Invoke(pct);

                        // Speed estimate every 500 ms
                        if (sw.ElapsedMilliseconds > 500)
                        {
                            double speed = (read - lastBytes) / (sw.ElapsedMilliseconds / 1000.0);
                            lastBytes = read;
                            sw.Restart();
                            Dispatcher.Invoke(() =>
                                ProgressSpeedLabel.Text = $"{FormatBytes((long)speed)}/s");
                        }
                    }
                }
            }
        }

        private static string FormatBytes(long bytes) =>
            bytes >= 1_048_576 ? $"{bytes / 1_048_576.0:F1} MB"
            : bytes >= 1024    ? $"{bytes / 1024.0:F0} KB"
                               : $"{bytes} B";

        // ── Process helper ────────────────────────────────────────────────────

        private static async Task RunProcessAsync(string exe, string args, int timeoutSec, CancellationToken ct)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute        = true,
                CreateNoWindow         = false,
                WindowStyle            = ProcessWindowStyle.Minimized,
            };

            var p = Process.Start(psi) ?? throw new Exception($"Failed to start {exe}");
            await Task.Run(() => p.WaitForExit(timeoutSec * 1000), ct);
        }

        // ── aria2 extraction ─────────────────────────────────────────────────

        private static void ExtractAria2(string zipPath, string destDir)
        {
            using var archive = ZipFile.OpenRead(zipPath);
            foreach (var entry in archive.Entries)
            {
                if (entry.Name.Equals("aria2c.exe", StringComparison.OrdinalIgnoreCase))
                {
                    entry.ExtractToFile(Path.Combine(destDir, "aria2c.exe"), overwrite: true);
                    break;
                }
            }
        }

        // ── Windows integration ───────────────────────────────────────────────

        private static void CreateShortcut(string lnkPath, string targetPath)
        {
            // Use WScript.Shell COM to create .lnk without third-party deps
            dynamic shell  = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!);
            dynamic link   = shell.CreateShortcut(lnkPath);
            link.TargetPath       = targetPath;
            link.WorkingDirectory = Path.GetDirectoryName(targetPath);
            link.Description      = "Thalamus AI — World's First L4.5 Agent";
            link.Save();
        }

        private static void RegisterWithArp(string installDir)
        {
            const string key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ThalamusAI";
            using var rk = Registry.CurrentUser.CreateSubKey(key, true);
            rk.SetValue("DisplayName",          "Thalamus AI");
            rk.SetValue("DisplayVersion",        "1.0.0");
            rk.SetValue("Publisher",             "Aphantic Corporations");
            rk.SetValue("InstallLocation",       installDir);
            rk.SetValue("UninstallString",       $"\"{Path.Combine(installDir, "Thalamus.exe")}\" --uninstall");
            rk.SetValue("DisplayIcon",           Path.Combine(installDir, "Thalamus.exe"));
            rk.SetValue("URLInfoAbout",          "https://thalamus.aphantic.skinticals.com");
            rk.SetValue("EstimatedSize",         (int)350_000, RegistryValueKind.DWord);
            rk.SetValue("NoModify",              1, RegistryValueKind.DWord);
        }

        private static void RegisterUriScheme(string installDir)
        {
            const string key = @"Software\Classes\thalamus";
            using var rk = Registry.CurrentUser.CreateSubKey(key, true);
            rk.SetValue("", "URL:Thalamus Protocol");
            rk.SetValue("URL Protocol", "");

            using var cmd = rk.CreateSubKey(@"shell\open\command", true);
            cmd.SetValue("", $"\"{Path.Combine(installDir, "Thalamus.exe")}\" \"%1\"");
        }

        private static void RegisterBridgeStartup(string installDir)
        {
            const string key = @"Software\Microsoft\Windows\CurrentVersion\Run";
            using var rk = Registry.CurrentUser.OpenSubKey(key, true);
            rk?.SetValue("ThalamusBridge", $"\"{Path.Combine(installDir, "thalamus-vm-bridge.exe")}\"");
        }

        // ── Progress / log helpers ────────────────────────────────────────────

        private void SetProgress(int pct, string step)
        {
            Dispatcher.Invoke(() =>
            {
                pct = Math.Clamp(pct, 0, 100);
                // ProgressFill lives inside a 700-px wide parent (560 minus padding)
                var parentWidth = ((Border)ProgressFill.Parent).ActualWidth;
                ProgressFill.Width        = parentWidth * pct / 100.0;
                ProgressPctLabel.Text     = $"{pct}%";
                InstallStepLabel.Text     = step;
            });
        }

        private void Log(string line)
        {
            Dispatcher.Invoke(() =>
            {
                LogBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}\n");
                LogScroll.ScrollToBottom();
            });
        }

        // ── Done / Error pages ────────────────────────────────────────────────

        private void Done_Finish(object sender, RoutedEventArgs e)
        {
            if (ChkLaunch.IsChecked == true)
            {
                var appExe = Path.Combine(_installDir, "Thalamus.exe");
                if (File.Exists(appExe))
                    Process.Start(new ProcessStartInfo(appExe) { UseShellExecute = true });
            }
            Close();
        }

        private void Error_Back(object sender, RoutedEventArgs e)  => ShowPage(2);
        private void Error_Retry(object sender, RoutedEventArgs e)
        {
            ShowPage(3);
            _installCts = new CancellationTokenSource();
            _ = RunInstallAsync(_installCts.Token);
        }

        // ── Window chrome ─────────────────────────────────────────────────────

        private void TitleBar_Drag(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed) DragMove();
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e)
        {
            if (_page == 3)
            {
                var result = System.Windows.MessageBox.Show(
                    "Installation is in progress. Are you sure you want to cancel?",
                    "Cancel Installation",
                    MessageBoxButton.YesNo, MessageBoxImage.Question);
                if (result != MessageBoxResult.Yes) return;
                _installCts?.Cancel();
            }
            Close();
        }

        protected override void OnClosed(EventArgs e)
        {
            _installCts?.Cancel();
            _http.Dispose();
            base.OnClosed(e);
        }
    }
}
