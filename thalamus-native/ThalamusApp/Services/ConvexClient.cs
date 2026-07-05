using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace ThalamusApp.Services
{
    public class ConvexClient
    {
        private const string CLOUD_URL  = "https://glad-ermine-937.convex.cloud";
        private const string SITE_URL   = "https://glad-ermine-937.convex.site";

        private readonly HttpClient _http;

        public ConvexClient()
        {
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("ThalamusDesktop/1.0");
        }

        // ── Core callers ──────────────────────────────────────────────────────

        public Task<JsonNode?> CallQueryAsync(string path, object args, string? token = null)
            => CallAsync("/api/query", path, args, token);

        public Task<JsonNode?> CallMutationAsync(string path, object args, string? token = null)
            => CallAsync("/api/mutation", path, args, token);

        public Task<JsonNode?> CallActionAsync(string path, object args, string? token = null)
            => CallAsync("/api/action", path, args, token);

        private async Task<JsonNode?> CallAsync(string endpoint, string path, object args, string? token)
        {
            var body = JsonSerializer.Serialize(new { path, args });
            using var req = new HttpRequestMessage(HttpMethod.Post, CLOUD_URL + endpoint)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            if (token != null)
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var resp = await _http.SendAsync(req);
            var json = await resp.Content.ReadAsStringAsync();

            if (!resp.IsSuccessStatusCode)
                throw new ConvexException(resp.StatusCode, json);

            var doc = JsonNode.Parse(json);
            return doc?["value"];
        }

        // ── Streaming chat endpoint (SSE on convex.site) ──────────────────────

        public string SiteUrl => SITE_URL;
        public HttpClient HttpClient => _http;
    }

    public class ConvexException : Exception
    {
        public System.Net.HttpStatusCode StatusCode { get; }
        public ConvexException(System.Net.HttpStatusCode code, string body)
            : base($"Convex {(int)code}: {(body.Length > 200 ? body[..200] : body)}")
        {
            StatusCode = code;
        }
    }
}
