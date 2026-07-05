using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;

namespace ThalamusApp.Auth
{
    public partial class LoginWindow : Window
    {
        private string _email = "";
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
        private const string CONVEX = "https://glad-ermine-937.convex.cloud";

        public string Token  { get; private set; } = "";
        public string Email  { get; private set; } = "";

        public LoginWindow() => InitializeComponent();

        // ── Send OTP ──────────────────────────────────────────────────────────

        private async void SendOtp_Click(object sender, RoutedEventArgs e)
        {
            EmailError.Visibility = Visibility.Collapsed;
            var email = EmailBox.Text.Trim();
            if (string.IsNullOrEmpty(email) || !email.Contains('@'))
            {
                ShowEmailError("Enter a valid email address.");
                return;
            }

            SetBusy(true, "Sending code...");
            try
            {
                await CallSignIn(email, code: null);
                _email = email;
                ShowOtpScreen();
            }
            catch (Exception ex)
            {
                ShowEmailError(ex.Message);
            }
            finally { SetBusy(false); }
        }

        // ── Verify OTP ────────────────────────────────────────────────────────

        private async void Verify_Click(object sender, RoutedEventArgs e)
        {
            OtpError.Visibility = Visibility.Collapsed;
            var code = OtpBox.Text.Trim();
            if (code.Length != 6)
            {
                ShowOtpError("Enter the 6-digit code from your email.");
                return;
            }

            SetBusy(true, "Verifying...");
            try
            {
                var token = await CallSignIn(_email, code);
                if (string.IsNullOrEmpty(token))
                    throw new Exception("Invalid or expired code. Try again.");

                AuthManager.SaveToken(_email, token);
                Token  = token;
                Email  = _email;
                DialogResult = true;
                Close();
            }
            catch (Exception ex)
            {
                ShowOtpError(ex.Message);
            }
            finally { SetBusy(false); }
        }

        // ── Convex customAuth actions ─────────────────────────────────────────
        // Matches the web app's use-auth.ts flow:
        //   Step 1: customAuth.sendOtp({ email })           → { success: true }
        //   Step 2: customAuth.verifyOtp({ email, code })   → { value: { token, userId, isNewUser, referralSpins } }

        private async System.Threading.Tasks.Task<string> CallSignIn(string email, string? code)
        {
            using var resp = await _http.PostAsync(
                CONVEX + "/api/action",
                new StringContent(
                    code == null
                        ? JsonSerializer.Serialize(new
                        {
                            path = "customAuth:sendOtp",
                            args = new { email }
                        })
                        : JsonSerializer.Serialize(new
                        {
                            path = "customAuth:verifyOtp",
                            args = new { email, code }
                        }),
                    Encoding.UTF8,
                    "application/json"));

            var json = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new Exception($"Server error {(int)resp.StatusCode}. Check your email.");

            var doc = JsonDocument.Parse(json);

            // After sending OTP there is no token yet
            if (code == null) return "";

            // After verifying — expect { value: { token: "..." } }
            if (doc.RootElement.TryGetProperty("value", out var val))
            {
                if (val.TryGetProperty("token", out var t) && t.ValueKind == JsonValueKind.String)
                    return t.GetString()!;

                if (val.ValueKind == JsonValueKind.Null)
                    throw new Exception("Invalid or expired code.");
            }

            if (doc.RootElement.TryGetProperty("errorMessage", out var err))
                throw new Exception(err.GetString() ?? "Sign-in failed.");

            throw new Exception("Unexpected response. Try again.");
        }

        // ── Navigation helpers ────────────────────────────────────────────────

        private void ShowOtpScreen()
        {
            EmailPanel.Visibility = Visibility.Collapsed;
            OtpPanel.Visibility   = Visibility.Visible;
            HeadingLabel.Text     = "Check your email";
            SubLabel.Text         = $"We sent a 6-digit code to {_email}";
            StatusLabel.Text      = "";
            OtpBox.Focus();
        }

        private void Back_Click(object sender, RoutedEventArgs e)
        {
            OtpPanel.Visibility   = Visibility.Collapsed;
            EmailPanel.Visibility = Visibility.Visible;
            HeadingLabel.Text     = "Sign in to Thalamus AI";
            SubLabel.Text         = "Enter your email to receive a login code";
            OtpError.Visibility   = Visibility.Collapsed;
            StatusLabel.Text      = "";
        }

        private void SetBusy(bool busy, string status = "")
        {
            SendOtpBtn.IsEnabled = !busy;
            VerifyBtn.IsEnabled  = !busy;
            StatusLabel.Text     = status;
        }

        private void ShowEmailError(string msg) { EmailError.Text = msg; EmailError.Visibility = Visibility.Visible; }
        private void ShowOtpError(string msg)   { OtpError.Text   = msg; OtpError.Visibility   = Visibility.Visible; }

        private void Field_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Return) return;
            if (OtpPanel.Visibility == Visibility.Visible) Verify_Click(null!, null!);
            else SendOtp_Click(null!, null!);
        }

        private void TitleBar_Drag(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed) DragMove();
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e) => Close();
    }
}
