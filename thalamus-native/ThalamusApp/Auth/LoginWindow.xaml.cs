using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace ThalamusApp.Auth
{
    public partial class LoginWindow : Window
    {
        private readonly LoginHandler _login = new();
        private readonly DispatcherTimer _animTimer = new()
        {
            Interval = TimeSpan.FromMilliseconds(400)
        };
        private int _animTick;

        public bool LoginSucceeded { get; private set; }
        public string Token { get; private set; } = "";
        public string Email { get; private set; } = "";

        public LoginWindow()
        {
            InitializeComponent();
            _animTimer.Tick += AnimateDots;
        }

        private void Window_Loaded(object sender, RoutedEventArgs e)
        {
            // Start the web auth flow immediately
            _ = StartAuthAsync();
        }

        private async System.Threading.Tasks.Task StartAuthAsync()
        {
            ShowLoading();

            var result = await _login.StartWebAuthAsync(
                new System.Threading.CancellationTokenSource(TimeSpan.FromMinutes(5)).Token);

            if (result.success)
            {
                Token = result.token;
                Email = result.email;
                LoginSucceeded = true;
                ShowSuccess();
                // Auto-close after brief success display
                await System.Threading.Tasks.Task.Delay(800);
                DialogResult = true;
                Close();
            }
            else
            {
                ShowError("Authorization failed or timed out.");
            }
        }

        private void OpenBrowser_Click(object sender, RoutedEventArgs e)
        {
            // Re-open browser with the auth code
            _ = StartAuthAsync();
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
            _animTimer.Start();
        }

        public void ShowCode(string code)
        {
            // Insert space in the middle for readability
            var display = code.Length > 4
                ? code[..4] + " " + code[4..]
                : code;
            CodeLabel.Text = display;
            StatusLabel.Text = "Waiting for authorization...";

            LoadingPanel.Visibility = Visibility.Collapsed;
            CodePanel.Visibility = Visibility.Visible;
            SuccessPanel.Visibility = Visibility.Collapsed;
            ErrorPanel.Visibility = Visibility.Collapsed;
            _animTimer.Stop();
        }

        private void ShowSuccess()
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            CodePanel.Visibility = Visibility.Collapsed;
            SuccessPanel.Visibility = Visibility.Visible;
            ErrorPanel.Visibility = Visibility.Collapsed;
            _animTimer.Stop();
        }

        private void ShowError(string message)
        {
            ErrorLabel.Text = message;
            LoadingPanel.Visibility = Visibility.Collapsed;
            CodePanel.Visibility = Visibility.Collapsed;
            SuccessPanel.Visibility = Visibility.Collapsed;
            ErrorPanel.Visibility = Visibility.Visible;
            _animTimer.Stop();
        }

        // ── Loading animation ─────────────────────────────────────────────────

        private void AnimateDots(object? sender, EventArgs e)
        {
            _animTick++;
            var phase = _animTick % 6;
            SetDotOpacity(Dot1Rotate, phase == 1 || phase == 2 || phase == 3 ? 1.0 : 0.3);
            SetDotOpacity(Dot2Rotate, phase == 2 || phase == 3 || phase == 4 ? 1.0 : 0.3);
            SetDotOpacity(Dot3Rotate, phase == 3 || phase == 4 || phase == 5 ? 1.0 : 0.3);
        }

        private static void SetDotOpacity(RotateTransform t, double opacity)
        {
            if (t.VisualParent is System.Windows.UIElement el)
                el.Opacity = opacity;
        }

        // ── Window chrome ─────────────────────────────────────────────────────

        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            DragMove();
        }

        private void OnClosing(object sender, CancelEventArgs e)
        {
            _animTimer.Stop();
            _login.Dispose();
        }
    }
}
