using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using ThalamusApp.Auth;
using ThalamusApp.Controls;
using ThalamusApp.Services;

namespace ThalamusApp
{
    public partial class MainWindow : Window
    {
        private const string APP_VERSION = "2.4.0";
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
        private readonly ConvexClient _convex = new();
        private bool _isAuthenticated;
        private string _activeMode = "Code";
        private DispatcherTimer? _creditsTimer;

        // Modes whose transcripts live in the conversations/messages tables and
        // therefore get the sidebar RECENT list. Build has projects, Sandbox VMs.
        private static readonly HashSet<string> ConversationModes = new() { "Chat", "Research", "Study" };

        // Kept so the Buy Credits dialog can be handed the live session identity.
        private string _sessionToken = "";
        private string _sessionEmail = "";

        public MainWindow()
        {
            InitializeComponent();
            // A borderless CenterScreen window that is taller/wider than the monitor
            // work area gets centered with its top above y=0, which pushes the custom
            // 38px titlebar (min/max/close) off the top edge — the header "disappears".
            // The login window is short enough to fit, so the header only vanishes once signed in.
            // Clamp the startup size to the work area (both are DIPs) so CenterScreen
            // always lands the window fully on-screen. Maximize is handled separately
            // by the WM_GETMINMAXINFO hook below.
            var wa = SystemParameters.WorkArea;
            if (Height > wa.Height) Height = wa.Height;
            if (Width > wa.Width) Width = wa.Width;
            VersionLabel.Text = $"v{APP_VERSION}";
            ThemeIcon.Text = ThemeManager.IsLight ? "🌙" : "☀";
            _ = Task.Run(CheckForUpdatesAsync);
        }

        private void ThemeToggle_Click(object sender, RoutedEventArgs e)
        {
            ThemeManager.Toggle();
            ThemeIcon.Text = ThemeManager.IsLight ? "🌙" : "☀";
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
            // SetResourceReference (not FindResource) — the dot lives for the
            // whole session and must follow a runtime theme toggle.
            AuthDot.SetResourceReference(System.Windows.Controls.Border.BackgroundProperty, "GreenBrush");
            AuthDot.ToolTip = email;

            // Signed in — show sign out + balance. Buy Credits only appears if
            // the platform actually sells credits right now (see below).
            BtnSignOut.Visibility = Visibility.Visible;
            CreditsRow.Visibility = Visibility.Visible;
            _ = RefreshBuyCreditsVisibilityAsync();
            SectionLabel.Text = email.Length > 18 ? email[..16] + "..." : email;

            // Pass token to mode views
            CodePanel.SetToken(token);
            ChatPanel.SetToken(token);
            ResearchPanel.SetToken(token);
            StudyPanel.SetToken(token);

            // Balance readout: ensure the daily allowance on first load (same as
            // the website), then keep it fresh on a slow timer — sends also poke
            // it via NotifyExchangeCompleted so it updates right after spending.
            _ = RefreshCreditsAsync(ensureDaily: true);
            if (_creditsTimer == null)
            {
                _creditsTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
                _creditsTimer.Tick += (_, _) => _ = RefreshCreditsAsync(ensureDaily: false);
            }
            _creditsTimer.Start();

            StatusText.Text = "Ready — Signed in";
            NavigateTo("Code");
        }

        // ── Credits + recents (called by mode views after each exchange) ──────

        /// <summary>
        /// Refresh the sidebar balance and the RECENT list. Safe from any thread;
        /// both refreshes are best-effort and never throw into the UI.
        /// </summary>
        public void NotifyExchangeCompleted()
        {
            _ = RefreshCreditsAsync(ensureDaily: false);
            _ = RefreshRecentAsync();
        }

        // Same flag the website's buy modal reads — when payments are switched
        // off platform-side, the desktop hides the button instead of opening a
        // dialog that can only apologize.
        private async Task RefreshBuyCreditsVisibilityAsync()
        {
            try
            {
                var cfg = await _convex.CallQueryAsync("payments:getPublicPaymentsConfig", new { });
                var enabled = (cfg as JsonObject)?["isEnabled"]?.GetValue<bool>() ?? false;
                Dispatcher.Invoke(() =>
                    BtnBuyCredits.Visibility = _isAuthenticated && enabled
                        ? Visibility.Visible : Visibility.Collapsed);
            }
            catch { /* unreachable backend — leave the button hidden */ }
        }

        private async Task RefreshCreditsAsync(bool ensureDaily)
        {
            if (!_isAuthenticated || string.IsNullOrEmpty(_sessionToken)) return;
            var token = _sessionToken;
            try
            {
                if (ensureDaily)
                {
                    try
                    {
                        await _convex.CallMutationAsync("customAuthHelpers:ensureDailyBalance",
                            new { token }, token);
                    }
                    catch { /* the balance query below still shows whatever is there */ }
                }

                var user = await _convex.CallQueryAsync("customAuthHelpers:getUserByToken",
                    new { token }, token);
                if (user is not JsonObject u) return;

                // Spendable = daily allowance (legacy field as fallback) + purchased.
                // Same formula the website renders (Portal.tsx).
                double daily = u["dailyAgentBucks"]?.GetValue<double>()
                    ?? u["agentBucksBalance"]?.GetValue<double>() ?? 0;
                double purchased = u["purchasedAgentBucks"]?.GetValue<double>() ?? 0;
                long total = (long)(daily + purchased);
                Dispatcher.Invoke(() => CreditsLabel.Text = $"{total:N0} AB");
            }
            catch { /* transient network failure — keep the last known value */ }
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

            _activeMode = mode;
            var hasRecents = _isAuthenticated && ConversationModes.Contains(mode);
            RecentSection.Visibility = hasRecents ? Visibility.Visible : Visibility.Collapsed;
            if (hasRecents) _ = RefreshRecentAsync();
        }

        // ── RECENT conversation list ──────────────────────────────────────────

        private async Task RefreshRecentAsync()
        {
            if (!_isAuthenticated || !ConversationModes.Contains(_activeMode)) return;
            var mode = _activeMode.ToLowerInvariant();
            var token = _sessionToken;
            try
            {
                var convs = await _convex.CallQueryAsync("conversations:list",
                    new { mode, token }, token) as JsonArray;
                Dispatcher.Invoke(() =>
                {
                    // A slow response from a previous mode must not clobber the
                    // list the user is actually looking at.
                    if (_activeMode.ToLowerInvariant() != mode) return;
                    PopulateRecent(convs);
                });
            }
            catch { /* offline — leave the current list alone */ }
        }

        private void PopulateRecent(JsonArray? convs)
        {
            RecentListPanel.Children.Clear();
            if (convs == null || convs.Count == 0)
            {
                var empty = new TextBlock
                {
                    Text = "No conversations yet",
                    FontSize = 10.5,
                    Margin = new Thickness(24, 6, 16, 0),
                };
                empty.SetResourceReference(TextBlock.ForegroundProperty, "TextMutedBrush");
                RecentListPanel.Children.Add(empty);
                return;
            }

            foreach (var c in convs)
            {
                var id = c?["_id"]?.GetValue<string>();
                if (id == null) continue;
                var title = c?["title"]?.GetValue<string>() ?? "Untitled";
                if (title.Length > 26) title = title[..24] + "…";

                var btn = new Button
                {
                    Style = (Style)FindResource("SidebarBtn"),
                    Height = 32,
                    FontSize = 11,
                    Tag = id,
                    Content = new TextBlock { Text = title, TextTrimming = TextTrimming.CharacterEllipsis },
                    ToolTip = c?["title"]?.GetValue<string>(),
                };
                btn.Click += RecentItem_Click;

                var menu = new ContextMenu();
                var del = new MenuItem { Header = "Delete conversation", Tag = id };
                del.Click += RecentDelete_Click;
                menu.Items.Add(del);
                btn.ContextMenu = menu;

                RecentListPanel.Children.Add(btn);
            }
        }

        private async void RecentItem_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button b || b.Tag is not string id) return;
            switch (_activeMode)
            {
                case "Chat": await ChatPanel.OpenConversationAsync(id); break;
                case "Research": await ResearchPanel.OpenConversationAsync(id); break;
                case "Study": await StudyPanel.OpenConversationAsync(id); break;
            }
        }

        private async void RecentDelete_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not MenuItem m || m.Tag is not string id) return;
            try
            {
                await _convex.CallMutationAsync("conversations:remove",
                    new { id, token = _sessionToken }, _sessionToken);
            }
            catch { return; /* delete failed — leave the open thread and the list alone */ }

            // If the open thread was deleted, drop the view to a fresh one.
            // StartNewConversation now defers when that view is mid-stream, so a
            // delete during a live reply can't silently no-op and strand a dead id.
            switch (_activeMode)
            {
                case "Chat" when ChatPanel.CurrentConversationId == id: ChatPanel.StartNewConversation(); break;
                case "Research" when ResearchPanel.CurrentConversationId == id: ResearchPanel.StartNewConversation(); break;
                case "Study" when StudyPanel.CurrentConversationId == id: StudyPanel.StartNewConversation(); break;
            }
            await RefreshRecentAsync();
        }

        private void NewChat_Click(object sender, RoutedEventArgs e)
        {
            switch (_activeMode)
            {
                case "Chat": ChatPanel.StartNewConversation(); break;
                case "Research": ResearchPanel.StartNewConversation(); break;
                case "Study": StudyPanel.StartNewConversation(); break;
            }
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
            _creditsTimer?.Stop();
            CreditsRow.Visibility = Visibility.Collapsed;
            CreditsLabel.Text = "—";
            RecentSection.Visibility = Visibility.Collapsed;
            RecentListPanel.Children.Clear();

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
                        UpdateLabel.Text = $"Update v{ver} available";
                        UpdateLabel.SetResourceReference(TextBlock.ForegroundProperty, "AmberBrush");
                        UpdateSubLabel.Text = "Restart to update";
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
