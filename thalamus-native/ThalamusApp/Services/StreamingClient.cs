using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace ThalamusApp.Services
{
    // Consumes the /stream-chat SSE endpoint (src/convex/http.ts). Events arrive
    // as "data: {json}" lines with a {type, chunk} payload; "thinking" chunks are
    // status notes, "answer" chunks are response text, and the final "done" event
    // carries the authoritative fullText. Note the session token is sent in the
    // request BODY — this endpoint does not read the Authorization header.
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

            // Built as a dictionary, not an anonymous type: a C# null serializes
            // as an explicit JSON null, and an explicit null is a different type
            // from an absent key to Convex argument validation. /stream-chat is
            // an unvalidated httpAction today, but the same shape is what every
            // other desktop call has to use, so keep it honest here too.
            var bodyObj = new Dictionary<string, object>
            {
                ["content"]      = content,
                ["mode"]         = mode,
                ["history"]      = messages,
                ["systemPrompt"] = systemPrompt,
                ["preferClaude"] = true,
                // Same date/time/timezone context the website sends (Portal.tsx),
                // so desktop replies know what "today" means.
                ["userContext"]  = new { datetime = LocalDateTimeString(), timezone = LocalTimeZoneId() },
            };
            if (!string.IsNullOrEmpty(token)) bodyObj["token"] = token!;
            if (!string.IsNullOrEmpty(conversationId)) bodyObj["conversationId"] = conversationId!;

            var bodyJson = JsonSerializer.Serialize(bodyObj);
            using var req = new HttpRequestMessage(HttpMethod.Post, _convex.SiteUrl + "/stream-chat")
            {
                Content = new StringContent(bodyJson, Encoding.UTF8, "application/json"),
            };

            // ResponseHeadersRead is essential: the default would buffer the whole
            // SSE body before returning, defeating the point of streaming.
            // ConfigureAwait(false) throughout: this is called from UI event
            // handlers, so without it every await resumes on the WPF dispatcher
            // and the read loop below blocks the window between chunks.
            using var resp = await _convex.StreamingHttpClient.SendAsync(
                req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();

            await using var stream = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var reader = new StreamReader(stream);

            string fullText = "";

            // Never StreamReader.EndOfStream here — it fills the buffer with a
            // SYNCHRONOUS read when empty, i.e. it blocks on the network for the
            // whole gap between chunks. ReadLineAsync returning null is the
            // end-of-stream signal.
            while (!ct.IsCancellationRequested
                   && await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line)
            {
                if (string.IsNullOrEmpty(line) || !line.StartsWith("data: ")) continue;

                var payload = line[6..];
                try
                {
                    var doc = JsonDocument.Parse(payload);
                    var type = doc.RootElement.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
                    var chunk = doc.RootElement.TryGetProperty("chunk", out var c) ? c.GetString() ?? "" : "";

                    if (type == "done")
                    {
                        // Prefer the server's fullText over our accumulated chunks —
                        // it is what was persisted, and survives any dropped events.
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

        // Mirrors the website's toLocaleString("en-US", { weekday, year, month,
        // day, hour, minute, timeZoneName }) — the server pastes this straight
        // into the system prompt, so it just has to read naturally.
        private static string LocalDateTimeString()
        {
            var now = DateTimeOffset.Now;
            var off = now.Offset;
            var sign = off < TimeSpan.Zero ? "-" : "+";
            return now.ToString("dddd, MMMM d, yyyy 'at' hh:mm tt", CultureInfo.InvariantCulture)
                 + $" GMT{sign}{Math.Abs(off.Hours):00}:{Math.Abs(off.Minutes):00}";
        }

        // The web sends an IANA zone ("Asia/Kolkata"); Windows stores its own
        // ids, so convert when we can and fall back to the Windows name.
        private static string LocalTimeZoneId()
        {
            var local = TimeZoneInfo.Local;
            if (local.HasIanaId) return local.Id;
            return TimeZoneInfo.TryConvertWindowsIdToIanaId(local.Id, out var iana) ? iana : local.Id;
        }
    }
}
