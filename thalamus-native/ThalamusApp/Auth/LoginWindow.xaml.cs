using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;

namespace ThalamusApp.Auth
{
    public partial class LoginWindow : Window
    {
        // ── Configuration ────────────────────────────────────────────────
        // Convex deployment URL — change this to your deployment URL
        private const string CONVEX_URL = "https://leadshello-agent-ai.hf.space";
        private const int POLL_INTERVAL_MS = 2000;
        private const int MAX_POLL_ATTEMPTS = 150; // 5 minutes max

        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
        private CancellationTokenSource? _pollingCts;
        private string _authCode = "";
        private string _siteUrl = "";
        private bool _isClosing = false;

        // ── Public properties (read by App.xaml.cs) ──────────────────────
        public bool LoginSucceeded { get; private set; }
        public string Token { get; private set; } = "";
        public string Email { get; private set; } = "";

        public LoginWindow()
        {
            InitializeComponent();
            Loaded += async (_, _) => await InitializeAsync();
        }

        private async Task InitializeAsync()
        {
            try
            {
                await Dispatcher.InvokeAsync(() =>
                {
                    ShowLoading(true);
                    ShowError(false);
                });

                await GenerateAuthCodeAsync();

                await Dispatcher.InvokeAsync(() =>
                {
                    ShowLoading(false);
                    ShowCodePanel(true);
                });

                StartPolling();
            }
            catch (Exception ex)
            {
                await Dispatcher.InvokeAsync(() =>
                {
                    ShowLoading(false);
                    ShowError(true, $"Failed to connect: {ex.Message}");
                });
            }
        }

        // ── Convex HTTP calls ────────────────────────────────────────────

        private async Task GenerateAuthCodeAsync()
        {
            var payload = new
            {
                path = "desktopAuthActions:createCode",
                args = new { }
            };

            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _http.PostAsync($"{CONVEX_URL}/api/action", content);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(responseJson);

            // The Convex action returns { code: "...", expiresAt: ... }
            var code = doc.RootElement.GetProperty("code").GetString() ?? "";
            if (string.IsNullOrEmpty(code))
                throw new Exception("Empty code received from server");

            _authCode = code;

            // Update UI
            var display = $"{code.Substring(0, 4)}  {code.Substring(4, 4)}";
            AuthCodeText.Text = display;

            _siteUrl = $"{CONVEX_URL}/auth/desktop?code={code}";
            UrlText.Text = _siteUrl;
        }

        private async Task<string> PollForAuthorizationAsync(CancellationToken ct)
        {
            var payload = new
            {
                path = "desktopAuth:pollCode",
                args = new { code = _authCode }
            };

            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _http.PostAsync($"{CONVEX_URL}/api/mutation", content, ct);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return responseJson;
        }

        // ── Polling logic ───────────────────────────────────────────────

        private void StartPolling()
        {
            _pollingCts?.Cancel();
            _pollingCts = new CancellationTokenSource();
            var ct = _pollingCts.Token;

            WaitingPanel.Visibility = Visibility.Visible;
            OpenBrowserBtn.Visibility = Visibility.Collapsed;

            _ = Task.Run(async () =>
            {
                for (int attempt = 0; attempt < MAX_POLL_ATTEMPTS && !ct.IsCancellationRequested; attempt++)
                {
                    try
                    {
                        await Task.Delay(POLL_INTERVAL_MS, ct);

                        var resultJson = await PollForAuthorizationAsync(ct);
                        var status = ParsePollResult(resultJson);

                        switch (status)
                        {
                            case "authorized":
                                await Dispatcher.InvokeAsync(() => HandleAuthorization(resultJson));
                                return;

                            case "expired":
                                await Dispatcher.InvokeAsync(() => ShowExpired(true));
                                return;

                            case "invalid":
                                await Dispatcher.InvokeAsync(() =>
                                {
                                    ShowError(true, "Invalid code. Please close and restart the app.");
                                });
                                return;
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"[Poll] Attempt {attempt}: {ex.Message}");

                        // Only show error after several consecutive failures
                        if (attempt >= 5)
                        {
                            await Dispatcher.InvokeAsync(() =>
                            {
                                ShowError(true, "Connection lost. Check your internet and retry.");
                            });
                            return;
                        }
                    }
                }

                // Polling timed out
                if (!ct.IsCancellationRequested)
                {
                    await Dispatcher.InvokeAsync(() => ShowExpired(true));
                }
            }, ct);
        }

        private string ParsePollResult(string json)
        {
            using var doc = JsonDocument.Parse(json);

            // The mutation might return the result directly or wrapped
            JsonElement result;

            if (doc.RootElement.TryGetProperty("result", out var wrapped))
                result = wrapped;
            else
                result = doc.RootElement;

            if (result.TryGetProperty("status", out var statusProp))
                return statusProp.GetString() ?? "pending";

            return "pending";
        }

        private void HandleAuthorization(string resultJson)
        {
            using var doc = JsonDocument.Parse(resultJson);
            JsonElement result;

            if (doc.RootElement.TryGetProperty("result", out var wrapped))
                result = wrapped;
            else
                result = doc.RootElement;

            if (result.TryGetProperty("token", out var tokenProp) &&
                result.TryGetProperty("email", out var emailProp))
            {
                Token = tokenProp.GetString() ?? "";
                Email = emailProp.GetString() ?? "";
                LoginSucceeded = true;
            }

            _pollingCts?.Cancel();

            // Show success briefly then close
            ShowCodePanel(false);
            SuccessPanel.Visibility = Visibility.Visible;

            var timer = new System.Timers.Timer(1500) { AutoReset = false };
            timer.Elapsed += (_, _) =>
            {
                Dispatcher.InvokeAsync(() =>
                {
                    if (!_isClosing)
                    {
                        _isClosing = true;
                        DialogResult = true;
                        Close();
                    }
                });
            };
            timer.Start();
        }

        // ── UI state helpers ────────────────────────────────────────────

        private void ShowLoading(bool show)
        {
            LoadingPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ShowCodePanel(bool show)
        {
            CodePanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ShowError(bool show, string? message = null)
        {
            if (show && message != null)
                ErrorText.Text = message;
            ErrorPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ShowExpired(bool show)
        {
            ExpiredPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
            WaitingPanel.Visibility = show ? Visibility.Collapsed : WaitingPanel.Visibility;
        }

        // ── Event handlers ──────────────────────────────────────────────

        private void TitleBar_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ClickCount == 1)
                DragMove();
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e)
        {
            _pollingCts?.Cancel();
            _isClosing = true;
            DialogResult = false;
            Close();
        }

        private void CopyUrl_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                Clipboard.SetText(_siteUrl);
                ((Button)sender).Content = "Copied!";

                var timer = new System.Timers.Timer(2000) { AutoReset = false };
                timer.Elapsed += (_, _) =>
                {
                    Dispatcher.InvokeAsync(() =>
                    {
                        ((Button)sender).Content = "Copy Link";
                    });
                };
                timer.Start();
            }
            catch
            {
                // Clipboard might fail on some systems
            }
        }

        private void OpenBrowser_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = _siteUrl,
                    UseShellExecute = true
                };
                System.Diagnostics.Process.Start(psi);
            }
            catch (Exception ex)
            {
                ShowError(true, $"Failed to open browser: {ex.Message}");
            }
        }

        private void Retry_Click(object sender, RoutedEventArgs e)
        {
            _pollingCts?.Cancel();
            ShowError(false);
            _ = InitializeAsync();
        }

        private async void GenerateNewCode_Click(object sender, RoutedEventArgs e)
        {
            _pollingCts?.Cancel();
            await Dispatcher.InvokeAsync(() =>
            {
                ShowExpired(false);
                ShowCodePanel(false);
                ShowLoading(true);
            });
            await GenerateAuthCodeAsync();
            await Dispatcher.InvokeAsync(() =>
            {
                ShowLoading(false);
                ShowCodePanel(true);
            });
            StartPolling();
        }

        protected override void OnClosed(EventArgs e)
        {
            _pollingCts?.Cancel();
            _pollingCts?.Dispose();
            _http.Dispose();
            base.OnClosed(e);
        }
    }
}
