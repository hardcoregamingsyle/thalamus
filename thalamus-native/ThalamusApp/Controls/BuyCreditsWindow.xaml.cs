using System;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using ThalamusApp.Services;

namespace ThalamusApp.Controls
{
    /// <summary>
    /// "Buy AgentBucks" dialog — the desktop mirror of the web BuyCreditsModal.
    /// Every payment runs through Buy Me a Coffee and is matched to the account
    /// strictly by email, so the hard requirement is to make the user pay under
    /// THIS account's email before we ever open the checkout page.
    /// </summary>
    public partial class BuyCreditsWindow : Window
    {
        // Per-view Convex client — the established pattern (ChatView/StudyView).
        private readonly ConvexClient _convex = new();
        private readonly string _token;

        // Seeded from what MainWindow already knows; upgraded to the value the
        // backend confirms for this token once the lookup lands.
        private string _accountEmail;
        private string _bmacUrl = "";

        public BuyCreditsWindow(string token, string email)
        {
            InitializeComponent();
            _token = token ?? "";
            _accountEmail = email ?? "";

            // Show the account email immediately so the warning is truthful even
            // if the account lookup below can't reach the backend.
            WarnEmailText.Text = _accountEmail;
            PacksEmailText.Text = string.IsNullOrEmpty(_accountEmail) ? "your account email" : _accountEmail;
        }

        private async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            // Availability gate: purchases ship disabled until an admin flips the
            // switch. Any failure here (offline, backend down, malformed config)
            // must land on the safe "unavailable" state — never a crash.
            try
            {
                var cfg = await _convex.CallQueryAsync("payments:getPublicPaymentsConfig", new { });
                var enabled = AsBool(cfg?["isEnabled"]);
                _bmacUrl = AsString(cfg?["bmacPageUrl"]);

                if (!enabled || string.IsNullOrWhiteSpace(_bmacUrl))
                {
                    ShowUnavailable("Credit purchases are currently disabled. Your daily free AgentBucks keep refilling as usual — check back soon.");
                    return;
                }

                // Best-effort account lookup. The token is the confirmed identity;
                // if this fails we keep the email MainWindow handed us.
                try
                {
                    var user = await _convex.CallQueryAsync(
                        "customAuthHelpers:getUserByToken", new { token = _token }, _token);
                    var email = AsString(user?["email"]);
                    if (!string.IsNullOrEmpty(email)) _accountEmail = email;

                    var balance = AsDouble(user?["dailyAgentBucks"]) + AsDouble(user?["purchasedAgentBucks"]);
                    if (balance > 0)
                    {
                        BalanceText.Text = $"Balance {balance:N0} AB";
                        BalanceText.Visibility = Visibility.Visible;
                    }
                }
                catch { /* keep the constructor email; balance stays hidden */ }

                WarnEmailText.Text = _accountEmail;
                PacksEmailText.Text = string.IsNullOrEmpty(_accountEmail) ? "your account email" : _accountEmail;
                ShowPacks();
            }
            catch
            {
                ShowUnavailable("We couldn't reach the store. Check your connection and try again shortly.");
            }
        }

        // ── State toggles ─────────────────────────────────────────────────────

        private void ShowUnavailable(string message)
        {
            UnavailableText.Text = message;
            LoadingPanel.Visibility = Visibility.Collapsed;
            UnavailablePanel.Visibility = Visibility.Visible;
            PacksPanel.Visibility = Visibility.Collapsed;
            WarningPanel.Visibility = Visibility.Collapsed;
        }

        private void ShowPacks()
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            UnavailablePanel.Visibility = Visibility.Collapsed;
            PacksPanel.Visibility = Visibility.Visible;
            WarningPanel.Visibility = Visibility.Collapsed;
        }

        private void ShowWarning()
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            UnavailablePanel.Visibility = Visibility.Collapsed;
            PacksPanel.Visibility = Visibility.Collapsed;
            WarningPanel.Visibility = Visibility.Visible;
        }

        // ── Actions ───────────────────────────────────────────────────────────

        // Any pack leads to the same blocking email warning before checkout.
        private void Pack_Click(object sender, RoutedEventArgs e) => ShowWarning();

        private void Back_Click(object sender, RoutedEventArgs e) => ShowPacks();

        private void Continue_Click(object sender, RoutedEventArgs e)
        {
            if (!string.IsNullOrWhiteSpace(_bmacUrl))
            {
                try
                {
                    Process.Start(new ProcessStartInfo { FileName = _bmacUrl, UseShellExecute = true });
                }
                catch
                {
                    // Shell couldn't resolve a browser — fall back to explorer.
                    try { Process.Start("explorer.exe", _bmacUrl); }
                    catch { Debug.WriteLine("Failed to open BMAC page."); }
                }
            }
            ShowPacks();
        }

        private async void CopyEmail_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(_accountEmail)) return;
            try { Clipboard.SetText(_accountEmail); }
            catch { return; } // clipboard can be locked by another process

            WarnCopyLabel.Text = "COPIED ✓";
            await Task.Delay(2000);
            WarnCopyLabel.Text = "TAP TO COPY";
        }

        // ── Window chrome ─────────────────────────────────────────────────────

        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e) => DragMove();

        private void CloseBtn_Click(object sender, RoutedEventArgs e) => Close();

        // ── Defensive JSON readers — never throw on a shape we didn't expect ──

        private static bool AsBool(JsonNode? n)
        {
            try { return n is not null && n.GetValue<bool>(); }
            catch { return false; }
        }

        private static string AsString(JsonNode? n)
        {
            try { return n?.GetValue<string>() ?? ""; }
            catch { return ""; }
        }

        private static double AsDouble(JsonNode? n)
        {
            if (n is null) return 0;
            try { return n.GetValue<double>(); }
            catch { return double.TryParse(n.ToString(), out var d) ? d : 0; }
        }
    }
}
