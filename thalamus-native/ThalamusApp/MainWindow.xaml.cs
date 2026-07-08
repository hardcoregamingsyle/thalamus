using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using ThalamusApp.Auth;

namespace ThalamusApp
{
    public partial class MainWindow : Window
    {
        private const string APP_VERSION = "2.0.0";
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
        private bool _isAuthenticated;

        public MainWindow()
        {
            InitializeComponent();
            VersionLabel.Text = $"v{APP_VERSION}";
            SetGuestMode();
            _ = Task.Run(CheckForUpdatesAsync);
        }

        /// <summary>
        /// Called by App.xaml.cs after restoring a saved session.
        /// Enables full access with the user's email shown.
        /// </summary>
        public void SetSession(string token, string email)
        {
            _isAuthenticated = true;
            UserLabel.Text = email;
            AuthDot.Fill = (Brush)FindResource("GreenBrush");
            AuthDot.ToolTip = email;

            // Show sign out, hide sign in
            BtnSignIn.Visibility = Visibility.Collapsed;
            BtnSignOut.Visibility = Visibility.Visible;
            SectionLabel.Text = email.Length > 18 ? email[..16] + "..." : email;

            // Pass token to mode views
            CodePanel.SetToken(token);
            ChatPanel.SetToken(token);
            ResearchPanel.SetToken(token);
            StudyPanel.SetToken(token);

            StatusText.Text = "Ready — Signed in";
            NavigateTo("Code");
        }

        /// <summary>
        /// Guest mode — limited features, sign-in button visible.
        /// </summary>
        private void SetGuestMode()
        {
            _isAuthenticated = false;
            UserLabel.Text = "Not signed in";
            AuthDot.Fill = (Brush)FindResource("AmberBrush");
            AuthDot.ToolTip = "Sign in to unlock all features";

            BtnSignIn.Visibility = Visibility.Visible;
            BtnSignOut.Visibility = Visibility.Collapsed;
            SectionLabel.Text = "ACCOUNT";

            StatusText.Text = "Ready — Guest";
            NavigateTo("Chat");
        }

        // ── Navigation ────────────────────────────────────────────────────────

        private void Nav_Click(object sender, RoutedEventArgs e)
        {
            if (sender is System.Windows.Controls.Button btn && btn.Tag is string mode)
                NavigateTo(mode);
        }

        private void NavigateTo(string mode)
        {
            switch (mode)
            {
                case "SignIn":
                    _ = SignInAsync();
                    return;
                case "Logout":
                    SignOut();
                    return;
            }

            // Toggle panel visibility
            CodePanel.Visibility     = mode == "Code"     ? Visibility.Visible : Visibility.Collapsed;
            ChatPanel.Visibility     = mode == "Chat"     ? Visibility.Visible : Visibility.Collapsed;
            ResearchPanel.Visibility = mode == "Research" ? Visibility.Visible : Visibility.Collapsed;
            StudyPanel.Visibility    = mode == "Study"    ? Visibility.Visible : Visibility.Collapsed;

            // Update nav highlights
            var inactive = (Style)FindResource("SidebarBtn");
            var active   = (Style)FindResource("SidebarBtnActive");
            BtnCode.Style     = mode == "Code"     ? active : inactive;
            BtnChat.Style     = mode == "Chat"     ? active : inactive;
            BtnResearch.Style = mode == "Research" ? active : inactive;
            BtnStudy.Style    = mode == "Study"    ? active : inactive;

            ModeLabel.Text = mode == "Code" ? "Build Mode" : mode + " Mode";
            StatusText.Text = _isAuthenticated ? $"Ready — {mode}" : "Ready — Guest";
        }

        /// <summary>
        /// Show the login dialog for web-based auth (opens browser to website).
        /// </summary>
        private async System.Threading.Tasks.Task SignInAsync()
        {
            var login = new LoginWindow();
            login.Owner = this;
            login.ShowDialog();

            if (login.LoginSucceeded)
            {
                AuthManager.SaveToken(login.Token, login.Email);
                SetSession(login.Token, login.Email);
            }
        }

        private void SignOut()
        {
            AuthManager.ClearToken();

            // Reset to guest mode
            _isAuthenticated = false;
            UserLabel.Text = "Not signed in";
            AuthDot.Fill = (Brush)FindResource("AmberBrush");
            AuthDot.ToolTip = "Sign in to unlock all features";

            BtnSignIn.Visibility = Visibility.Visible;
            BtnSignOut.Visibility = Visibility.Collapsed;
            SectionLabel.Text = "ACCOUNT";

            // Clear tokens from mode views
            CodePanel.SetToken("");
            ChatPanel.SetToken("");
            ResearchPanel.SetToken("");
            StudyPanel.SetToken("");

            StatusText.Text = "Ready — Guest";
            NavigateTo("Chat");
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
    }
}
