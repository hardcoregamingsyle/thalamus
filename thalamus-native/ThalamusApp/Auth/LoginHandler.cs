using System;
using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace ThalamusApp.Auth
{
    public class LoginHandler : IDisposable
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
        /// Step 1: Generate an auth code via Convex action.
        /// Returns (code, expiresAt).
        /// </summary>
        public async Task<(string code, long expiresAt)> GenerateAuthCodeAsync(CancellationToken ct)
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
        /// Step 2: Open browser to the website auth page with the code.
        /// </summary>
        public void OpenBrowserWithCode(string code)
        {
            var authUrl = $"{SITE_URL}/auth/desktop?code={code}";
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = authUrl,
                    UseShellExecute = true
                });
            }
            catch
            {
                try { Process.Start("explorer.exe", authUrl); }
                catch { Debug.WriteLine("Failed to open browser."); }
            }
        }

        /// <summary>
        /// Step 3: Poll the Convex mutation until the code is authorized or expires.
        /// </summary>
        public async Task<(bool success, string token, string email)> PollForAuthorizationAsync(
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
                        Token = token;
                        Email = email;
                        IsAuthenticated = true;
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
        /// Sign out: clear saved token and reset state.
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
            GC.SuppressFinalize(this);
        }
    }
}
