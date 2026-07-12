using System;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using ThalamusApp.Services;

namespace ThalamusApp.Auth
{
    public class LoginHandler : IDisposable
    {
        // The public website (where the user authorizes the desktop code). The
        // old value pointed at a dead hf.space host — must be the real site.
        private const string SITE_URL = "https://thalamus.aphantic.skinticals.com";
        private const int POLL_INTERVAL_MS = 2000;
        private const int MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

        // Reuse ConvexClient so the Convex HTTP envelope ({path,args} in the
        // body, result unwrapped from {status,value}) is handled correctly.
        // The previous hand-rolled calls used a query-param format Convex
        // doesn't accept and read fields off the wrong level — every launch
        // failed with "Connection error".
        private readonly ConvexClient _convex = new();

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
        /// Step 1: Generate an auth code via the Convex action. Returns (code, expiresAt).
        /// </summary>
        public async Task<(string code, long expiresAt)> GenerateAuthCodeAsync(CancellationToken ct)
        {
            var value = await _convex.CallActionAsync("desktopAuthActions:createCode", new { });
            if (value is null) throw new InvalidOperationException("Empty response from createCode.");

            var code = value["code"]?.GetValue<string>() ?? "";
            // Convex serializes JS numbers as JSON numbers — read as double, then
            // narrow, so a value expressed with a decimal point never throws.
            var expiresAt = (long)(value["expiresAt"]?.GetValue<double>() ?? 0);
            return (code, expiresAt);
        }

        /// <summary>
        /// Step 2: Open the browser to the website auth page with the code.
        /// </summary>
        public void OpenBrowserWithCode(string code)
        {
            var authUrl = $"{SITE_URL}/auth/desktop?code={code}";
            try
            {
                Process.Start(new ProcessStartInfo { FileName = authUrl, UseShellExecute = true });
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
            var startTime = DateTime.UtcNow;

            while (!ct.IsCancellationRequested)
            {
                if ((DateTime.UtcNow - startTime).TotalMilliseconds > MAX_POLL_DURATION_MS)
                    return (false, "", ""); // Timeout

                await Task.Delay(POLL_INTERVAL_MS, ct);

                try
                {
                    var value = await _convex.CallMutationAsync("desktopAuth:pollCode", new { code = code.ToUpperInvariant() });
                    var status = value?["status"]?.GetValue<string>() ?? "pending";

                    if (status == "authorized")
                    {
                        Token = value?["token"]?.GetValue<string>() ?? "";
                        Email = value?["email"]?.GetValue<string>() ?? "";
                        IsAuthenticated = true;
                        return (true, Token, Email);
                    }

                    if (status == "expired" || status == "invalid")
                        return (false, "", "");
                }
                catch (ConvexException)
                {
                    // Transient backend/network error — keep polling.
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

        public void Dispose() => GC.SuppressFinalize(this);
    }
}
