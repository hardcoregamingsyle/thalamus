using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace ThalamusApp.Services
{
    // Cloud persistence for a mode's chat thread, backed by the same Convex
    // conversations/messages tables the website uses. Each mode view owns one
    // store. Flow: SetToken → LoadLatestAsync (pull newest conversation +
    // messages), then EnsureAsync before the first send so /stream-chat gets a
    // conversationId — the server persists both turns only when one is present.
    public class ConversationStore
    {
        private readonly ConvexClient _convex;
        private readonly string _mode;

        public string? ConversationId { get; private set; }

        public ConversationStore(ConvexClient convex, string mode)
        {
            _convex = convex;
            _mode = mode;
        }

        // Sign-in/out boundary — next send starts (or loads) a fresh thread.
        public void Reset() => ConversationId = null;

        // Load the most recent conversation for this mode and return its
        // messages (role, content) oldest-first. Sets ConversationId so
        // subsequent sends append to the same thread. Returns empty on any
        // failure — persistence must never break the chat itself.
        public async Task<List<(string role, string content)>> LoadLatestAsync(string token)
        {
            var loaded = new List<(string role, string content)>();
            try
            {
                var convs = await _convex.CallQueryAsync("conversations:list",
                    new { mode = _mode, token }, token) as JsonArray;
                if (convs == null || convs.Count == 0) return loaded;

                var convId = convs[0]?["_id"]?.GetValue<string>();
                if (convId == null) return loaded;
                ConversationId = convId;

                var msgs = await _convex.CallQueryAsync("conversations:getMessages",
                    new { conversationId = convId, token }, token) as JsonArray;
                if (msgs == null) return loaded;

                foreach (var m in msgs)
                {
                    var role = m?["role"]?.GetValue<string>() ?? "";
                    var content = m?["content"]?.GetValue<string>() ?? "";
                    if (role.Length > 0 && content.Length > 0)
                        loaded.Add((role, content));
                }
            }
            catch { /* offline / expired token — chat still works unpersisted */ }
            return loaded;
        }

        // Create the conversation on first send if none exists yet.
        public async Task EnsureAsync(string token, string firstMessage)
        {
            if (ConversationId != null) return;
            try
            {
                var title = firstMessage.Length > 50 ? firstMessage[..50] : firstMessage;
                var created = await _convex.CallMutationAsync("conversations:create",
                    new { title, mode = _mode, token }, token);
                ConversationId = created?["id"]?.GetValue<string>();
            }
            catch { /* best-effort — a null id just means this send isn't persisted */ }
        }
    }
}
