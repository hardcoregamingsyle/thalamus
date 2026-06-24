using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace ThalamusApp.Services
{
    public class StreamingClient
    {
        private readonly ConvexClient _convex;

        public StreamingClient(ConvexClient convex) => _convex = convex;

        // Fires for each streamed chunk, with (chunkType, text).
        // chunkType: "thinking" | "answer" | "done"
        public delegate void ChunkHandler(string type, string chunk);

        public async Task<string> StreamChatAsync(
            string content,
            string mode,
            List<(string role, string text)> history,
            string systemPrompt,
            string? token,
            string? conversationId,
            ChunkHandler onChunk,
            CancellationToken ct = default)
        {
            var messages = new List<object>();
            foreach (var (role, text) in history)
                messages.Add(new { role, content = text });

            var bodyObj = new
            {
                content,
                mode,
                history    = messages,
                systemPrompt,
                token,
                conversationId,
                preferClaude = true,
            };

            var bodyJson = JsonSerializer.Serialize(bodyObj);
            using var req = new HttpRequestMessage(HttpMethod.Post, _convex.SiteUrl + "/stream-chat")
            {
                Content = new StringContent(bodyJson, Encoding.UTF8, "application/json"),
            };

            using var resp = await _convex.HttpClient.SendAsync(
                req, HttpCompletionOption.ResponseHeadersRead, ct);
            resp.EnsureSuccessStatusCode();

            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var reader = new StreamReader(stream);

            string fullText = "";

            while (!reader.EndOfStream && !ct.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(ct);
                if (string.IsNullOrEmpty(line) || !line.StartsWith("data: ")) continue;

                var payload = line[6..];
                try
                {
                    var doc = JsonDocument.Parse(payload);
                    var type = doc.RootElement.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
                    var chunk = doc.RootElement.TryGetProperty("chunk", out var c) ? c.GetString() ?? "" : "";

                    if (type == "done")
                    {
                        if (doc.RootElement.TryGetProperty("fullText", out var ft))
                            fullText = ft.GetString() ?? fullText;
                        onChunk("done", fullText);
                        break;
                    }

                    if (chunk.Length > 0)
                    {
                        if (type == "answer") fullText += chunk;
                        onChunk(type, chunk);
                    }
                }
                catch { /* skip malformed SSE events */ }
            }

            return fullText;
        }
    }
}
