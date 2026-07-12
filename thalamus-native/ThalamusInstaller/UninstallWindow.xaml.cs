using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using Microsoft.Win32;

namespace ThalamusInstaller
{
    /// <summary>
    /// The /uninstall flow. Removes the app files, shortcuts, and registry
    /// entries; VM data (disks + downloaded ISOs) is only deleted when the
    /// user opts in. The running setup exe deletes itself via a delayed
    /// cmd.exe hand-off after the window closes.
    /// </summary>
    public partial class UninstallWindow : Window
    {
        private readonly string _installDir;
        private readonly string _dataDir;
        private bool _uninstalled;

        // Subdirectories that hold user VM data — preserved unless the user
        // ticks "Also delete VM data". "isos"/"disks" are legacy locations
        // created by older installers.
        private static readonly string[] DataDirs = { "VMs", "ISOs", "isos", "disks" };

        public UninstallWindow()
        {
            InitializeComponent();

            _dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Thalamus");

            // The installer copies ThalamusSetup.exe into the install dir, so
            // our own location *is* the install dir. Fall back to the default
            // location if we're somehow run from elsewhere.
            var exeDir = Path.GetDirectoryName(Environment.ProcessPath);
            _installDir = exeDir != null && File.Exists(Path.Combine(exeDir, "Thalamus.exe"))
                ? exeDir
                : _dataDir;

            InstallPathLabel.Text = $"App files in {_installDir}";
        }

        // ── Flow ──────────────────────────────────────────────────────────────

        private async void Uninstall_Click(object sender, RoutedEventArgs e)
        {
            bool purgeData = ChkData.IsChecked == true;

            PageConfirm.Visibility = Visibility.Collapsed;
            PageWorking.Visibility = Visibility.Visible;

            await Task.Run(() => RunUninstall(purgeData));
            _uninstalled = true;

            DoneDetail.Text = purgeData
                ? "All app files and VM data were deleted."
                : "App files were deleted. Your VM disks and ISOs were kept in "
                  + Path.Combine(_dataDir, "VMs") + ".";

            PageWorking.Visibility = Visibility.Collapsed;
            PageDone.Visibility    = Visibility.Visible;
        }

        private void RunUninstall(bool purgeData)
        {
            SetWorking("Stopping Thalamus…");
            KillProcess("Thalamus");
            KillProcess("thalamus-vm-bridge");
            Thread.Sleep(500); // let file handles close before deleting

            SetWorking("Removing shortcuts…");
            RemoveShortcuts();

            SetWorking("Cleaning registry…");
            RemoveRegistry();

            SetWorking("Deleting files…");
            RemoveFiles(purgeData);
        }

        // ── Steps ─────────────────────────────────────────────────────────────

        private static void KillProcess(string name)
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                try { p.Kill(entireProcessTree: true); p.WaitForExit(3000); }
                catch { /* already gone or access denied — deletion will skip locked files */ }
                finally { p.Dispose(); }
            }
        }

        private static void RemoveShortcuts()
        {
            try
            {
                var desktop = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    "Thalamus AI.lnk");
                if (File.Exists(desktop)) File.Delete(desktop);

                var startMenu = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                    "Programs", "Thalamus AI");
                if (Directory.Exists(startMenu)) Directory.Delete(startMenu, true);
            }
            catch { /* best effort — a stale shortcut is not worth failing over */ }
        }

        private static void RemoveRegistry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Thalamus", false);
                Registry.CurrentUser.DeleteSubKeyTree(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ThalamusAI", false);
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\thalamus", false);

                using var run = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true);
                run?.DeleteValue("ThalamusBridge", false);
            }
            catch { /* best effort */ }
        }

        private void RemoveFiles(bool purgeData)
        {
            var self = Path.GetFullPath(Environment.ProcessPath ?? "");

            try
            {
                foreach (var file in Directory.GetFiles(_installDir))
                {
                    // Can't delete the exe that's running this code — handled
                    // by the delayed cmd.exe hand-off in ScheduleSelfDelete.
                    if (string.Equals(Path.GetFullPath(file), self, StringComparison.OrdinalIgnoreCase))
                        continue;
                    // The ISO location map belongs to the VM data.
                    if (!purgeData && Path.GetFileName(file).Equals("iso-paths.json", StringComparison.OrdinalIgnoreCase))
                        continue;
                    try { File.Delete(file); } catch { }
                }

                foreach (var dir in Directory.GetDirectories(_installDir))
                {
                    var name = Path.GetFileName(dir);
                    if (!purgeData && Array.Exists(DataDirs,
                            d => d.Equals(name, StringComparison.OrdinalIgnoreCase)))
                        continue;
                    try { Directory.Delete(dir, true); } catch { }
                }

                // With a custom install dir, the VM data lives separately under
                // %LOCALAPPDATA%\Thalamus — purge that too when asked.
                if (purgeData &&
                    !string.Equals(Path.GetFullPath(_installDir).TrimEnd('\\'),
                                   Path.GetFullPath(_dataDir).TrimEnd('\\'),
                                   StringComparison.OrdinalIgnoreCase) &&
                    Directory.Exists(_dataDir))
                {
                    try { Directory.Delete(_dataDir, true); } catch { }
                }
            }
            catch { /* whatever survived gets picked up on a reinstall */ }
        }

        /// <summary>
        /// A running exe can't delete itself — hand the final cleanup to
        /// cmd.exe with a short delay: delete this exe, then remove the install
        /// dir (rd without /s only succeeds once the dir is empty, so kept VM
        /// data is never touched).
        /// </summary>
        private void ScheduleSelfDelete()
        {
            var self = Environment.ProcessPath;
            if (self == null) return;

            var args = $"/c ping -n 3 127.0.0.1 >nul & del /f /q \"{self}\" & rd \"{_installDir}\"";
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe", args)
                {
                    CreateNoWindow  = true,
                    UseShellExecute = false,
                    WindowStyle     = ProcessWindowStyle.Hidden,
                });
            }
            catch { /* worst case: an orphaned setup exe remains */ }
        }

        private void SetWorking(string text) =>
            Dispatcher.Invoke(() => WorkingLabel.Text = text);

        // ── Window chrome ─────────────────────────────────────────────────────

        private void TitleBar_Drag(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed) DragMove();
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e) => Close();
        private void Finish_Click(object sender, RoutedEventArgs e) => Close();

        protected override void OnClosed(EventArgs e)
        {
            if (_uninstalled) ScheduleSelfDelete();
            base.OnClosed(e);
        }
    }
}
