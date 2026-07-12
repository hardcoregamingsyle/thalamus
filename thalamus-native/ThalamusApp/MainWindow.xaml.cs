using System;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using ThalamusApp.Auth;
using ThalamusApp.Controls;

namespace ThalamusApp
{
    public partial class MainWindow : Window
    {
        private const string APP_VERSION = "2.3.2";
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
        private bool _isAuthenticated;

        // Kept so the Buy Credits dialog can be handed the live session identity.
        private string _sessionToken = "";
        private string _sessionEmail = "";

        public MainWindow()
        {
            InitializeComponent();
            VersionLabel.Text = $"v{APP_VERSION}";
            _ = Task.Run(CheckForUpdatesAsync);
        }

        /// <summary>
        /// Called by App.xaml.cs after restoring a saved session.
        /// Enables full access with the user's email shown.
        /// </summary>
        public void SetSession(string token, string email)
        {
            _isAuthenticated = true;
            _sessionToken = token;
            _sessionEmail = email;
            UserLabel.Text = email;
            AuthDot.Background = (Brush)FindResource("GreenBrush");
            AuthDot.ToolTip = email;

            // Signed in — show sign out + buy credits
            BtnSignOut.Visibility = Visibility.Visible;
            BtnBuyCredits.Visibility = Visibility.Visible;
            SectionLabel.Text = email.Length > 18 ? email[..16] + "..." : email;

            // Pass token to mode views
            CodePanel.SetToken(token);
            ChatPanel.SetToken(token);
            ResearchPanel.SetToken(token);
            StudyPanel.SetToken(token);

            StatusText.Text = "Ready — Signed in";
            NavigateTo("Code");
        }

        // ── Navigation ────────────────────────────────────────────────────────

        private void Nav_Click(object sender, RoutedEventArgs e)
        {
            if (sender is System.Windows.Controls.Button btn && btn.Tag is string mode)
                NavigateTo(mode);
        }

        private void NavigateTo(string mode)
        {
            if (mode == "Logout")
            {
                SignOut();
                return;
            }

            // Toggle panel visibility
            CodePanel.Visibility     = mode == "Code"     ? Visibility.Visible : Visibility.Collapsed;
            ChatPanel.Visibility     = mode == "Chat"     ? Visibility.Visible : Visibility.Collapsed;
            ResearchPanel.Visibility = mode == "Research" ? Visibility.Visible : Visibility.Collapsed;
            StudyPanel.Visibility    = mode == "Study"    ? Visibility.Visible : Visibility.Collapsed;
            SandboxPanel.Visibility  = mode == "Sandbox"  ? Visibility.Visible : Visibility.Collapsed;

            // Update nav highlights
            var inactive = (Style)FindResource("SidebarBtn");
            var active   = (Style)FindResource("SidebarBtnActive");
            BtnCode.Style     = mode == "Code"     ? active : inactive;
            BtnChat.Style     = mode == "Chat"     ? active : inactive;
            BtnResearch.Style = mode == "Research" ? active : inactive;
            BtnStudy.Style    = mode == "Study"    ? active : inactive;
            BtnSandbox.Style  = mode == "Sandbox"  ? active : inactive;

            ModeLabel.Text = mode == "Code" ? "Build Mode" : mode + " Mode";
            StatusText.Text = $"Ready — {mode}";
        }

        /// <summary>
        /// Sign out, then require a fresh sign-in. There is no guest mode, so
        /// cancelling the login exits the app rather than dropping to a guest UI.
        /// </summary>
        private void SignOut()
        {
            AuthManager.ClearToken();
            _isAuthenticated = false;
            _sessionToken = "";
            _sessionEmail = "";

            // Clear tokens from mode views
            CodePanel.SetToken("");
            ChatPanel.SetToken("");
            ResearchPanel.SetToken("");
            StudyPanel.SetToken("");

            var login = new LoginWindow { Owner = this };
            if (login.ShowDialog() == true && login.LoginSucceeded)
            {
                AuthManager.SaveToken(login.Token, login.Email);
                SetSession(login.Token, login.Email);
            }
            else
            {
                Application.Current.Shutdown();
            }
        }

        /// <summary>
        /// Open the Buy AgentBucks dialog. Only meaningful while signed in — it
        /// needs the session token to look up the account email a payment must use.
        /// </summary>
        private void BuyCredits_Click(object sender, RoutedEventArgs e)
        {
            if (!_isAuthenticated || string.IsNullOrEmpty(_sessionToken)) return;
            new BuyCreditsWindow(_sessionToken, _sessionEmail) { Owner = this }.ShowDialog();
        }

        // ── Auto-update ───────────────────────────────────────────────────────

        private async Task CheckForUpdatesAsync()
        {
            try
            {
                _http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "ThalamusApp/" + APP_VERSION);
                var json = await _http.GetStringAsync(
                    "https://api.github.com/repos/hardcoregamingsyle/thalamus/releases/latest");
                var doc = JsonDocument.Parse(json);
                var tag = doc.RootElement.GetProperty("tag_name").GetString() ?? "";
                var ver = tag.TrimStart('v', 'V');

                if (CompareVersions(ver, APP_VERSION) > 0)
                {
                    Dispatcher.Invoke(() =>
                    {
                        UpdateLabel.Text       = $"Update v{ver} available";
                        UpdateLabel.Foreground = new SolidColorBrush(Color.FromRgb(245, 158, 11));
                        UpdateSubLabel.Text    = "Restart to update";
                    });
                }
            }
            catch { }
        }

        private static int CompareVersions(string a, string b)
        {
            var pa = a.Split('.');
            var pb = b.Split('.');
            for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
            {
                int x = i < pa.Length && int.TryParse(pa[i], out var v1) ? v1 : 0;
                int y = i < pb.Length && int.TryParse(pb[i], out var v2) ? v2 : 0;
                if (x != y) return x.CompareTo(y);
            }
            return 0;
        }

        // ── Window chrome ─────────────────────────────────────────────────────

        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ClickCount == 2) ToggleMaximise();
            else DragMove();
        }

        private void MinBtn_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
        private void MaxBtn_Click(object sender, RoutedEventArgs e) => ToggleMaximise();
        private void ClsBtn_Click(object sender, RoutedEventArgs e) => Close();

        private void ToggleMaximise() =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void Window_StateChanged(object sender, EventArgs e) =>
            MaxBtn.Content = WindowState == WindowState.Maximized ? "❐" : "□";

        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            _http.Dispose();
        }

        // ── Borderless maximize fix ───────────────────────────────────────────
        // A WindowStyle="None" window maximizes over the entire monitor, spilling
        // past the screen edge and pushing the custom titlebar (and its buttons)
        // off-screen so the window can't be closed. Hook WM_GETMINMAXINFO and clamp
        // the maximized bounds to the monitor WORK AREA so the taskbar and titlebar
        // stay on-screen.

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            var hwnd = new WindowInteropHelper(this).Handle;
            HwndSource.FromHwnd(hwnd)?.AddHook(WndProc);
        }

        private const int WM_GETMINMAXINFO = 0x0024;
        private const int MONITOR_DEFAULTTONEAREST = 0x00000002;

        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg != WM_GETMINMAXINFO) return IntPtr.Zero;

            var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);
                var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
                GetMonitorInfo(monitor, ref mi);
                RECT work = mi.rcWork, screen = mi.rcMonitor;

                // Maximized size/position, in coordinates relative to the monitor,
                // using the work area (taskbar excluded) instead of the full screen.
                mmi.ptMaxPosition.x = work.left - screen.left;
                mmi.ptMaxPosition.y = work.top - screen.top;
                mmi.ptMaxSize.x = work.right - work.left;
                mmi.ptMaxSize.y = work.bottom - work.top;

                // Our hook suppresses WPF's own WM_GETMINMAXINFO handling, so carry
                // the window's minimum size across (converted to device pixels).
                var src = HwndSource.FromHwnd(hwnd);
                double dpiX = src?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
                double dpiY = src?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;
                mmi.ptMinTrackSize.x = (int)(MinWidth * dpiX);
                mmi.ptMinTrackSize.y = (int)(MinHeight * dpiY);

                Marshal.StructureToPtr(mmi, lParam, true);
            }

            handled = true;
            return IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int x; public int y; }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int left; public int top; public int right; public int bottom; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MINMAXINFO
        {
            public POINT ptReserved;
            public POINT ptMaxSize;
            public POINT ptMaxPosition;
            public POINT ptMinTrackSize;
            public POINT ptMaxTrackSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int dwFlags);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
    }
}
