using System;
using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace ThalamusApp.Auth
{
    public class LoginHandler
    {
        private const string CONVEX_SITE = "https://glad-ermine-937.convex.cloud";
        private const string SITE_URL = "https://leadshello-agent-ai.hf.space";
        private const int POLL_INTERVAL_MS = 2000;
        private const int MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };

        public bool IsAuthenticated { get; private set; }
        public string Token { get; private set; } = "";
        public string Email { get; private set; } = "";

        /// <summary>
        /// Try to restore a saved session. Returns true if a valid session was found.
        /// </summary>
        public bool TryRestoreSession()
        {
            var stored = AuthManager.LoadToken();
            if (stored.HasValue)
            {
                Token = stored.Value.token;
                Email = stored.Value.email;
                IsAuthenticated = true;
                return true;
            }
            return false;
        }

        /// <summary>
        /// Start the web-based auth flow:
        /// 1. Generate an auth code via Convex action
        /// 2. Open browser to website with the code
        /// 3. Poll for authorization
        /// 4. Return the session token and email
        /// </summary>
        public async Task<(bool success, string token, string email)> StartWebAuthAsync(
            CancellationToken cancellationToken)
        {
            try
            {
                // Step 1: Generate auth code via Convex
                var (code, expiresAt) = await GenerateAuthCodeAsync(cancellationToken);
                if (string.IsNullOrEmpty(code))
                    return (false, "", "");

                // Step 2: Open browser to website with the code
                var authUrl = $"{SITE_URL}/auth/desktop?code={code}";
                OpenBrowser(authUrl);

                // Step 3: Poll for authorization
                var result = await PollForAuthorizationAsync(code, cancellationToken);

                if (result.success)
                {
                    Token = result.token;
                    Email = result.email;
                    IsAuthenticated = true;
                    AuthManager.SaveToken(Token, Email);
                }

                return result;
            }
            catch (OperationCanceledException)
            {
                return (false, "", "");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"WebAuth error: {ex.Message}");
                return (false, "", "");
            }
        }

        /// <summary>
        /// Call the Convex action to create an auth code
        /// POST /api/action/{componentPath}:{actionName}
        /// </summary>
        private async Task<(string code, long expiresAt)> GenerateAuthCodeAsync(CancellationToken ct)
        {
            var url = $"{CONVEX_SITE}/api/action?componentPath=%2F&actionName=desktopAuthActions%3AcreateCode";
            var payload = JsonSerializer.Serialize(new { args = new { } });
            var content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json");

            var response = await _http.PostAsync(url, content, ct);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync(ct);
            var doc = JsonDocument.Parse(json);

            var code = doc.RootElement.GetProperty("code").GetString() ?? "";
            var expiresAt = doc.RootElement.GetProperty("expiresAt").GetInt64();
            return (code, expiresAt);
        }

        /// <summary>
        /// Poll the Convex mutation until the code is authorized or expires
        /// POST /api/mutation/{componentPath}:{mutationName}
        /// </summary>
        private async Task<(bool success, string token, string email)> PollForAuthorizationAsync(
            string code, CancellationToken ct)
        {
            var url = $"{CONVEX_SITE}/api/mutation?componentPath=%2F&mutationName=desktopAuth%3ApollCode";
            var startTime = DateTime.UtcNow;

            while (!ct.IsCancellationRequested)
            {
                if ((DateTime.UtcNow - startTime).TotalMilliseconds > MAX_POLL_DURATION_MS)
                    return (false, "", ""); // Timeout

                await Task.Delay(POLL_INTERVAL_MS, ct);

                try
                {
                    var payload = JsonSerializer.Serialize(new { args = new { code = code.ToUpper() } });
                    var content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json");
                    var response = await _http.PostAsync(url, content, ct);
                    response.EnsureSuccessStatusCode();
                    var json = await response.Content.ReadAsStringAsync(ct);
                    var doc = JsonDocument.Parse(json);

                    var status = doc.RootElement.GetProperty("status").GetString() ?? "pending";

                    if (status == "authorized")
                    {
                        var token = doc.RootElement.GetProperty("token").GetString() ?? "";
                        var email = doc.RootElement.GetProperty("email").GetString() ?? "";
                        return (true, token, email);
                    }

                    if (status == "expired" || status == "invalid")
                        return (false, "", "");
                }
                catch (HttpRequestException)
                {
                    // Transient network error — retry
                    continue;
                }
            }

            return (false, "", "");
        }

        /// <summary>
        /// Open a URL in the default browser
        /// </summary>
        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch
            {
                // Fallback
                Process.Start("explorer.exe", url);
            }
        }

        /// <summary>
        /// Sign out: clear saved token and reset state
        /// </summary>
        public void SignOut()
        {
            AuthManager.ClearToken();
            IsAuthenticated = false;
            Token = "";
            Email = "";
        }

        public void Dispose()
        {
            _http.Dispose();
        }
    }
}
