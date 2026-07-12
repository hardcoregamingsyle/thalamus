using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace ThalamusApp
{
    public partial class SandboxView : UserControl
    {
        private QemuBridgeManager? _bridge;
        private IsoLibrary?        _isos;
        private EmbeddedVncClient? _vnc;
        private WriteableBitmap?   _vncBitmap;

        private CatalogRow? _selectedRow;
        private string?     _currentVmId    = null;
        private int         _currentVncPort = 0;

        // Per-entry UI state — one row in the catalog list.
        private sealed class CatalogRow
        {
            public IsoLibrary.IsoEntry Entry = null!;
            public Border     Root          = null!;
            public TextBlock  Status        = null!;
            public StackPanel Actions       = null!;
            public Border     ProgressTrack = null!;
            public ColumnDefinition DoneCol = null!;
            public ColumnDefinition LeftCol = null!;
            public CancellationTokenSource? Cts;   // non-null while downloading
        }

        private static readonly SolidColorBrush SelectedBg =
            new(Color.FromRgb(0x0d, 0x1f, 0x3c));

        static SandboxView() => SelectedBg.Freeze();

        public SandboxView()
        {
            InitializeComponent();
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            // Re-entry guard — the view is unloaded/reloaded when the user
            // switches modes, but catalog rows only need building once.
            if (_bridge != null) return;

            var installDir = ResolveInstallDir();
            _bridge = new QemuBridgeManager(installDir);
            _isos   = new IsoLibrary(installDir);

            RamSlider.ValueChanged   += (_, _) => RamLabel.Text   = $"{(int)RamSlider.Value} MB";
            CoresSlider.ValueChanged += (_, _) => CoresLabel.Text = $"{(int)CoresSlider.Value} Cores";

            BuildOsList();
            AppendConsole("VM Sandbox ready. Images download on demand into " + _isos.IsoDirectory);
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            _vnc?.Disconnect();
        }

        // ── Catalog list ──────────────────────────────────────────────────────

        private void BuildOsList()
        {
            foreach (var entry in IsoLibrary.Catalog)
            {
                var row = BuildRow(entry);
                var host = entry.Category switch
                {
                    "windows" => OsWindows,
                    "android" => OsAndroid,
                    "custom"  => OsCustom,
                    _         => OsLinux,
                };
                host.Children.Add(row.Root);
                RefreshRow(row);
            }
        }

        private CatalogRow BuildRow(IsoLibrary.IsoEntry entry)
        {
            var row = new CatalogRow { Entry = entry };

            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var textStack = new StackPanel();
            textStack.Children.Add(new TextBlock
            {
                Text = entry.Name,
                FontSize = 11.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            row.Status = new TextBlock
            {
                FontSize = 9.5,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
                Margin = new Thickness(0, 2, 0, 0),
                TextWrapping = TextWrapping.Wrap,
            };
            textStack.Children.Add(row.Status);
            grid.Children.Add(textStack);

            row.Actions = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(8, 0, 0, 0),
            };
            Grid.SetColumn(row.Actions, 1);
            grid.Children.Add(row.Actions);

            // Progress bar — a 2-star-column grid; the columns' star weights are
            // set to done/remaining fractions so the fill tracks the download.
            row.DoneCol = new ColumnDefinition { Width = new GridLength(0.0001, GridUnitType.Star) };
            row.LeftCol = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
            var fillGrid = new Grid();
            fillGrid.ColumnDefinitions.Add(row.DoneCol);
            fillGrid.ColumnDefinitions.Add(row.LeftCol);
            fillGrid.Children.Add(new Border
            {
                Background = (Brush)FindResource("BlueGradient"),
                CornerRadius = new CornerRadius(1.5),
            });
            row.ProgressTrack = new Border
            {
                Height = 3,
                CornerRadius = new CornerRadius(1.5),
                Background = SelectedBg,
                Margin = new Thickness(0, 7, 0, 1),
                Child = fillGrid,
                Visibility = Visibility.Collapsed,
            };
            Grid.SetRow(row.ProgressTrack, 1);
            Grid.SetColumnSpan(row.ProgressTrack, 2);
            grid.Children.Add(row.ProgressTrack);

            row.Root = new Border
            {
                Background = (Brush)FindResource("BgCardBrush"),
                BorderBrush = (Brush)FindResource("BorderDimBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 3, 0, 3),
                Cursor = Cursors.Hand,
                Child = grid,
            };
            row.Root.MouseLeftButtonDown += (_, _) => SelectRow(row);

            return row;
        }

        private void SelectRow(CatalogRow row)
        {
            if (_selectedRow != null)
            {
                _selectedRow.Root.BorderBrush = (Brush)FindResource("BorderDimBrush");
                _selectedRow.Root.Background  = (Brush)FindResource("BgCardBrush");
            }

            _selectedRow = row;
            row.Root.BorderBrush = (Brush)FindResource("BlueBrush");
            row.Root.Background  = SelectedBg;

            DisplayText.Text = $"Ready to boot: {row.Entry.Name}";
            IsoHint.Text     = "";
        }

        /// <summary>Sync a row's status line and action buttons with disk state.</summary>
        private void RefreshRow(CatalogRow row)
        {
            var e = row.Entry;
            row.Actions.Children.Clear();

            if (row.Cts != null)
            {
                // Download in flight — progress callback owns the status text.
                row.ProgressTrack.Visibility = Visibility.Visible;
                row.Actions.Children.Add(MakeAction("Cancel", () => row.Cts?.Cancel()));
                return;
            }
            row.ProgressTrack.Visibility = Visibility.Collapsed;

            var manual = _isos!.GetManualPath(e.Id);

            // Custom entry — bring your own ISO.
            if (e.Id == "custom")
            {
                row.Status.Text = manual != null ? Path.GetFileName(manual) : e.Note;
                row.Actions.Children.Add(MakeAction("Browse…", () => PickIso(row)));
                if (manual != null)
                    row.Actions.Children.Add(MakeAction("Clear", () => { _isos.Delete(e); RefreshRow(row); }));
                return;
            }

            // Manual-download entry (Windows eval) — no stable direct URL.
            if (e.DownloadUrl == null)
            {
                if (manual != null)
                {
                    row.Status.Text = $"Ready — {Path.GetFileName(manual)}";
                    row.Actions.Children.Add(MakeAction("Clear", () => { _isos.Delete(e); RefreshRow(row); }));
                }
                else
                {
                    row.Status.Text = e.Note;
                    row.Actions.Children.Add(MakeAction("Get ISO", () => OpenUrl(e.InfoUrl!)));
                    row.Actions.Children.Add(MakeAction("Locate…", () => PickIso(row)));
                }
                return;
            }

            // Direct-download entry.
            if (_isos.IsDownloaded(e))
            {
                var size = new FileInfo(Path.Combine(_isos.IsoDirectory, e.FileName!)).Length;
                row.Status.Text = $"Downloaded — {IsoLibrary.FormatBytes(size)}";
                row.Actions.Children.Add(MakeAction("Delete", () =>
                {
                    _isos.Delete(e);
                    RefreshRow(row);
                    AppendConsole($"Deleted {e.FileName}.");
                }));
                return;
            }

            long partial = _isos.PartialBytes(e);
            if (partial > 0)
            {
                row.Status.Text = $"Paused — {IsoLibrary.FormatBytes(partial)} of {IsoLibrary.FormatBytes(e.SizeBytes)}";
                row.Actions.Children.Add(MakeAction("Resume", () => StartDownload(row)));
                row.Actions.Children.Add(MakeAction("Delete", () =>
                {
                    _isos.Delete(e);
                    RefreshRow(row);
                }));
            }
            else
            {
                row.Status.Text = $"{IsoLibrary.FormatBytes(e.SizeBytes)} — official download";
                row.Actions.Children.Add(MakeAction("Download", () => StartDownload(row)));
            }
        }

        private Button MakeAction(string label, Action onClick)
        {
            var btn = new Button
            {
                Content = label,
                Style   = (Style)FindResource("IsoActionBtn"),
                Margin  = new Thickness(4, 0, 0, 0),
            };
            btn.Click += (_, args) => { args.Handled = true; onClick(); };
            return btn;
        }

        // ── Download / locate ─────────────────────────────────────────────────

        private async void StartDownload(CatalogRow row)
        {
            var e = row.Entry;
            row.Cts = new CancellationTokenSource();
            RefreshRow(row);
            row.Status.Text = "Connecting…";
            AppendConsole($"Downloading {e.Name} ({IsoLibrary.FormatBytes(e.SizeBytes)})…");

            var progress = new Progress<(long done, long total)>(p =>
            {
                double frac = p.total > 0 ? (double)p.done / p.total : 0;
                row.DoneCol.Width = new GridLength(Math.Max(frac, 0.0001), GridUnitType.Star);
                row.LeftCol.Width = new GridLength(Math.Max(1 - frac, 0.0001), GridUnitType.Star);
                row.Status.Text =
                    $"{IsoLibrary.FormatBytes(p.done)} of {IsoLibrary.FormatBytes(p.total)}  ·  {frac * 100:F0}%";
            });

            try
            {
                await _isos!.DownloadAsync(e, progress, row.Cts.Token);
                AppendConsole($"✓ {e.Name} downloaded.");
            }
            catch (OperationCanceledException)
            {
                AppendConsole($"Download paused — resume any time. ({e.Name})");
            }
            catch (Exception ex)
            {
                AppendConsole($"✗ Download failed: {ex.Message}");
                if (e.InfoUrl != null)
                    AppendConsole($"  Get it manually from {e.InfoUrl} and use the Custom ISO entry.");
            }
            finally
            {
                row.Cts?.Dispose();
                row.Cts = null;
                RefreshRow(row);
            }
        }

        private void PickIso(CatalogRow row)
        {
            var dlg = new Microsoft.Win32.OpenFileDialog
            {
                Title  = $"Choose an ISO for {row.Entry.Name}",
                Filter = "Disc images (*.iso)|*.iso|All files (*.*)|*.*",
            };
            if (dlg.ShowDialog() != true) return;

            _isos!.SetManualPath(row.Entry.Id, dlg.FileName);
            RefreshRow(row);
            AppendConsole($"{row.Entry.Name} → {dlg.FileName}");
        }

        private void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                AppendConsole($"Could not open browser: {ex.Message}");
            }
        }

        // ── Boot ──────────────────────────────────────────────────────────────

        private async void BootButton_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedRow == null)
            {
                AppendConsole("⚠  Select an operating system first.");
                return;
            }
            if (_bridge == null || _isos == null) return;

            var entry   = _selectedRow.Entry;
            var isoPath = _isos.Resolve(entry.Id);
            if (isoPath == null)
            {
                IsoHint.Text = entry.DownloadUrl != null
                    ? $"No ISO yet — click Download next to \"{entry.Name}\" first."
                    : entry.InfoUrl != null
                        ? "Download the evaluation ISO from Microsoft (Get ISO), then click Locate… to point Thalamus at the file."
                        : "Click Browse… and pick an ISO file first.";
                AppendConsole($"⚠  {entry.Name}: no ISO available yet.");
                return;
            }

            BootButton.IsEnabled = false;
            SetVmStatus("Booting…", Colors.Goldenrod);
            DisplayText.Text = $"Starting {entry.Name}…";
            IsoHint.Text     = "";

            AppendConsole($"Booting {entry.Id} | RAM {(int)RamSlider.Value} MB | {(int)CoresSlider.Value} cores");
            AppendConsole($"ISO: {isoPath}");

            var result = await _bridge.BootVMAsync(entry.Id, isoPath, (int)RamSlider.Value, (int)CoresSlider.Value);

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
                    IsoHint.Text = $"ISO not found: {result.IsoNeeded}";
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

            if (_bridge == null || _currentVmId == null) return;
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

        private void OnVncConnectionChanged(object? sender, EmbeddedVncClient.ConnectionEventArgs e)
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

        private void OnVncFrameUpdated(object? sender, EmbeddedVncClient.FrameUpdateEventArgs e)
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
            if (_bridge == null) return;
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
                SendCommand_Click(this, new RoutedEventArgs());
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
