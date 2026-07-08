using System;
using System.ComponentModel;
using System.Threading;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace ThalamusApp.Auth
{
    public partial class LoginWindow : Window
    {
        private readonly LoginHandler _login = new();
        private CancellationTokenSource? _pollCts;

        public bool LoginSucceeded { get; private set; }
        public string Token { get; private set; } = "";
        public string Email { get; private set; } = "";

        public LoginWindow()
        {
            InitializeComponent();
        }

        private void Window_Loaded(object sender, RoutedEventArgs e)
        {
            _ = StartAuthAsync();
        }

        /// <summary>
        /// Starts the web-based auth flow:
        /// 1. Generate auth code via Convex action
        /// 2. Show the code and open browser
        /// 3. Poll for authorization
        /// 4. Return token on success
        /// </summary>
        private async System.Threading.Tasks.Task StartAuthAsync()
        {
            ShowLoading();
            _pollCts = new CancellationTokenSource(TimeSpan.FromMinutes(5));

            try
            {
                // Step 1: Generate auth code
                var (code, _) = await _login.GenerateAuthCodeAsync(_pollCts.Token);

                if (string.IsNullOrEmpty(code))
                {
                    Dispatcher.Invoke(() => ShowError("Failed to generate auth code."));
                    return;
                }

                // Step 2: Show code and open browser
                Dispatcher.Invoke(() => ShowCode(code));
                _login.OpenBrowserWithCode(code);

                // Step 3: Poll for authorization
                var result = await _login.PollForAuthorizationAsync(code, _pollCts.Token);

                if (result.success)
                {
                    Token = result.token;
                    Email = result.email;
                    LoginSucceeded = true;
                    Dispatcher.Invoke(ShowSuccess);
                    await System.Threading.Tasks.Task.Delay(1000);
                    Dispatcher.Invoke(() => { DialogResult = true; Close(); });
                }
                else
                {
                    Dispatcher.Invoke(() => ShowError("Authorization timed out or was declined."));
                }
            }
            catch (OperationCanceledException)
            {
                Dispatcher.Invoke(() => ShowError("Authorization cancelled or timed out."));
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Auth error: {ex.Message}");
                Dispatcher.Invoke(() => ShowError("Connection error. Please try again."));
            }
        }

        private void OpenBrowser_Click(object sender, RoutedEventArgs e)
        {
            // Re-open browser with the same code
            if (!string.IsNullOrEmpty(CodeLabel.Text.Replace(" ", "")))
            {
                var code = CodeLabel.Text.Replace(" ", "");
                _login.OpenBrowserWithCode(code);
                StatusLabel.Text = "Waiting for authorization...";
            }
        }

        private void Retry_Click(object sender, RoutedEventArgs e)
        {
            _ = StartAuthAsync();
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }

        // ── UI state helpers ──────────────────────────────────────────────────

        private void ShowLoading()
        {
            LoadingPanel.Visibility = Visibility.Visible;
            CodePanel.Visibility = Visibility.Collapsed;
            SuccessPanel.Visibility = Visibility.Collapsed;
            ErrorPanel.Visibility = Visibility.Collapsed;

            // Start dot animation
            _ = AnimateDotsAsync();
        }

        private void ShowCode(string code)
        {
            // Insert space in the middle for readability
            var display = code.Length > 4
                ? code[..4] + " " + code[4..]
                : code;
            CodeLabel.Text = display;
            StatusLabel.Text = "Waiting for authorization in browser...";

            LoadingPanel.Visibility = Visibility.Collapsed;
            CodePanel.Visibility = Visibility.Visible;
            SuccessPanel.Visibility = Visibility.Collapsed;
            ErrorPanel.Visibility = Visibility.Collapsed;
        }

        private void ShowSuccess()
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            CodePanel.Visibility = Visibility.Collapsed;
            SuccessPanel.Visibility = Visibility.Visible;
            ErrorPanel.Visibility = Visibility.Collapsed;
        }

        private void ShowError(string message)
        {
            ErrorLabel.Text = message;
            LoadingPanel.Visibility = Visibility.Collapsed;
            CodePanel.Visibility = Visibility.Collapsed;
            SuccessPanel.Visibility = Visibility.Collapsed;
            ErrorPanel.Visibility = Visibility.Visible;
        }

        // ── Animated dots ─────────────────────────────────────────────────────

        private async System.Threading.Tasks.Task AnimateDotsAsync()
        {
            var dots = new[] { Dot1, Dot2, Dot3 };
            int tick = 0;

            while (LoadingPanel.Visibility == Visibility.Visible)
            {
                for (int i = 0; i < 3; i++)
                {
                    var active = (tick + i) % 6 < 3;
                    await Dispatcher.InvokeAsync(() =>
                        dots[i].Opacity = active ? 1.0 : 0.25
                    );
                }
                tick++;
                await System.Threading.Tasks.Task.Delay(350);
            }
        }

        // ── Window chrome ─────────────────────────────────────────────────────

        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            DragMove();
        }

        private void OnClosing(object sender, CancelEventArgs e)
        {
            _pollCts?.Cancel();
            _pollCts?.Dispose();
            _login.Dispose();
        }
    }
}
