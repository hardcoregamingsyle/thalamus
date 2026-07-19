using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using ThalamusApp.Controls;
using ThalamusApp.Services;

namespace ThalamusApp.Modes
{
    public partial class ChatView : UserControl
    {
        private string? _token;
        private readonly ConvexClient _convex = new();
        private StreamingClient? _streaming;
        private readonly List<(string role, string text)> _history = new();
        private ConversationStore? _store;
        private bool _historyLoaded;
        private CancellationTokenSource? _cts;
        private bool _isStreaming;
        private bool _isOpening;     // a RECENT open is fetching — block sends until it lands
        private bool _pendingReset;  // "+ New"/delete arrived mid-stream — reset when it ends
        private StackPanel? _liveContent;      // assistant bubble content host (HTML rendered on "done")
        private TextBlock? _liveStreamBlock;   // live plaintext preview shown while streaming
        private string _liveText = "";
        private bool _adRequested;   // one sponsored card per session (mirrors web adRequestedRef)

        public ChatView()
        {
            InitializeComponent();
            _streaming = new StreamingClient(_convex);
            _store = new ConversationStore(_convex, "chat");
        }

        public void SetToken(string token)
        {
            _token = token;
            _adRequested = false;   // sign-in/out is the session boundary — allow a fresh ad
            _store!.Reset();
            _historyLoaded = false;
            if (string.IsNullOrEmpty(token))
            {
                ChatCreditsLabel.Text = "Signed out";
                return;
            }
            ChatCreditsLabel.Text = "Signed in";
            _ = LoadHistoryAsync(token);
        }

        // Pull the newest cloud conversation for this account and replay it into
        // the panel, so chats survive app restarts and follow the user's account.
        private async Task LoadHistoryAsync(string token)
        {
            var loaded = await _store!.LoadLatestAsync(token);
            if (_historyLoaded || loaded.Count == 0) return;
            _historyLoaded = true;
            Dispatcher.Invoke(() => ReplayMessages(loaded));
        }

        /// <summary>The thread sends currently append to (null = fresh).</summary>
        public string? CurrentConversationId => _store?.ConversationId;

        /// <summary>Open a specific past conversation from the sidebar RECENT list.</summary>
        public async Task OpenConversationAsync(string conversationId)
        {
            if (string.IsNullOrEmpty(_token) || _isStreaming || _isOpening) return;
            if (_store!.ConversationId == conversationId) return;
            _isOpening = true;
            try
            {
                var loaded = await _store.LoadByIdAsync(_token, conversationId);
                if (loaded == null) return;   // load failed — keep the current thread and transcript
                _historyLoaded = true;
                Dispatcher.Invoke(() =>
                {
                    ClearTranscript();
                    ReplayMessages(loaded);
                    EmptyState.Visibility = loaded.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
                });
            }
            finally { _isOpening = false; }
        }

        /// <summary>Drop to a fresh thread — the next send creates a new conversation.</summary>
        public void StartNewConversation()
        {
            _historyLoaded = true;   // explicit choice — a late startup load must not undo it
            if (_isStreaming) { _pendingReset = true; return; }   // defer until the stream ends
            _store!.Reset();
            _history.Clear();
            ClearTranscript();
            EmptyState.Visibility = Visibility.Visible;
        }

        // Remove every transcript element except the typing row (last child).
        private void ClearTranscript()
        {
            _history.Clear();
            while (MessagesPanel.Children.Count > 1)
                MessagesPanel.Children.RemoveAt(0);
        }

        private void ReplayMessages(List<(string role, string content)> loaded)
        {
            if (loaded.Count == 0) return;
            EmptyState.Visibility = Visibility.Collapsed;
            foreach (var (role, content) in loaded)
            {
                if (role == "user")
                {
                    AppendUserBubble(content);
                }
                else
                {
                    AppendAiBubbleStart(out var host, out _);
                    HtmlToWpf.Populate(host, content);
                }
                _history.Add((role, content));
            }
            ScrollToBottom();
        }

        private void ChatInput_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return && Keyboard.Modifiers == ModifierKeys.None)
            {
                e.Handled = true;
                _ = SendAsync();
            }
        }

        private void Send_Click(object sender, RoutedEventArgs e) => _ = SendAsync();

        // Prompt chips prefill the input (mirrors the website's setInput) rather
        // than firing immediately — the user still presses Enter / Send to run it.
        private void Example_Click(object sender, MouseButtonEventArgs e)
        {
            if (sender is Border b && b.Child is TextBlock tb)
            {
                ChatInputBox.Text = tb.Text;
                ChatInputBox.Focus();
                ChatInputBox.CaretIndex = tb.Text.Length;
            }
        }

        private async Task SendAsync()
        {
            var text = ChatInputBox.Text.Trim();
            if (string.IsNullOrEmpty(text) || _isStreaming || _isOpening) return;

            ChatInputBox.Text = "";
            EmptyState.Visibility = Visibility.Collapsed;

            AppendUserBubble(text);
            _history.Add(("user", text));

            TypingRow.Visibility = Visibility.Visible;
            ScrollToBottom();

            _isStreaming = true;
            SendButton.IsEnabled = false;
            _cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
            _liveText = "";
            _liveContent = null;
            _liveStreamBlock = null;

            try
            {
                // Make sure a cloud conversation exists so the server persists
                // both turns of this exchange (it only saves with a conversationId).
                if (!string.IsNullOrEmpty(_token))
                    await _store!.EnsureAsync(_token, text);

                // "chat" mode → the backend's default model routing picks the model.
                // Same HTML-forcing system prompt the website sends (Portal.tsx), so the
                // model returns semantic HTML we render, instead of raw Markdown.
                await _streaming!.StreamChatAsync(
                    text, "chat", _history,
                    "You are Thalamus AI, an advanced AI assistant. CRITICAL: respond in clean, " +
                    "semantic HTML only — no Markdown, no plain text, no code fences around the whole reply. " +
                    "Use <h2>/<h3>, <p>, <ul>/<ol>/<li>, <strong>, <em>, <code>, <pre><code>, <blockquote>, " +
                    "<a>, and <table> where appropriate. Be clear, accurate, and well-structured.",
                    _token, _store!.ConversationId,
                    (type, chunk) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (type == "done")
                            {
                                // chunk is the server's authoritative fullText.
                                FinishStream(chunk);
                                return;
                            }
                            if (type == "answer")
                            {
                                _liveText += chunk;
                                if (_liveContent == null)
                                {
                                    TypingRow.Visibility = Visibility.Collapsed;
                                    AppendAiBubbleStart(out _liveContent, out _liveStreamBlock);
                                }
                                // Show a plain-text preview while streaming; the HTML can't be
                                // rendered mid-stream (unclosed tags), so we format it on "done".
                                _liveStreamBlock!.Text = HtmlToWpf.PlainText(_liveText);
                                ScrollToBottom();
                            }
                        });
                    },
                    _cts.Token);
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    TypingRow.Visibility = Visibility.Collapsed;
                    AppendAiError(ex.Message.Contains("401") || ex.Message.Contains("token")
                        ? "Please sign in to use AI features."
                        : "Something went wrong. Please try again.");
                    _isStreaming = false;
                    SendButton.IsEnabled = true;
                    if (_pendingReset) { _pendingReset = false; StartNewConversation(); }
                });
            }
        }

        private void FinishStream(string fullText)
        {
            TypingRow.Visibility = Visibility.Collapsed;
            if (!string.IsNullOrEmpty(fullText))
            {
                // Ensure a bubble exists (e.g. a stream that delivered only a final fullText),
                // then replace the live plaintext preview with the rendered HTML.
                if (_liveContent == null)
                    AppendAiBubbleStart(out _liveContent, out _liveStreamBlock);
                HtmlToWpf.Populate(_liveContent, fullText);
                _history.Add(("assistant", fullText));
            }
            _isStreaming = false;
            SendButton.IsEnabled = true;
            ScrollToBottom();

            // First real reply of the session → try to surface one sponsored card.
            // Fire-and-forget and fully guarded, so ads can never stall or break chat.
            if (!string.IsNullOrEmpty(fullText))
                _ = MaybeRequestAdAsync();

            // Every exchange spends AgentBucks and may have created a thread —
            // poke the sidebar so balance + RECENT stay honest. First exchange
            // also gets a proper AI title, like the website.
            if (!string.IsNullOrEmpty(fullText) && !string.IsNullOrEmpty(_token))
            {
                var main = Window.GetWindow(this) as MainWindow;   // capture on the UI thread
                if (_history.Count == 2)
                    _ = TitleThenRefreshAsync(main, _token, _history[0].text);
                main?.NotifyExchangeCompleted();
            }

            // A "+ New"/delete that arrived mid-stream was deferred — apply it now
            // that the stream has ended and the id is safely captured by the request.
            if (_pendingReset) { _pendingReset = false; StartNewConversation(); }
        }

        // Title the freshly created thread, then refresh RECENT again once the
        // title lands so the sidebar swaps the truncated-prompt fallback for the
        // real AI title (the first list refresh races ahead of the title action).
        private async Task TitleThenRefreshAsync(MainWindow? main, string token, string firstMessage)
        {
            await _store!.GenerateTitleAsync(token, firstMessage);
            main?.NotifyExchangeCompleted();
        }

        // ── Sponsored ad (Gravity) ───────────────────────────────────────────

        private async Task MaybeRequestAdAsync()
        {
            if (_adRequested) return;
            _adRequested = true;

            try
            {
                // Last ~6 turns, each capped ~1000 chars — the same window the backend
                // trims to, so we never ship a whole transcript for ad context.
                var recent = _history.Count > 6
                    ? _history.GetRange(_history.Count - 6, 6)
                    : _history;
                var messages = new List<object>();
                foreach (var (role, text) in recent)
                    messages.Add(new { role, content = text.Length > 1000 ? text[..1000] : text });

                // count:1 → the action returns a single ad object, or null on no-fill.
                var result = await _convex.CallActionAsync(
                    "gravityAds:requestAd",
                    new { token = _token, messages, sessionId = (string?)null, count = 1 },
                    _token);

                if (result is not JsonObject ad) return;

                Dispatcher.Invoke(() =>
                {
                    var card = new SponsoredAdCard();
                    card.Populate(ad);
                    // Insert before the (hidden) typing row so the card sits under the reply.
                    MessagesPanel.Children.Insert(MessagesPanel.Children.Count - 1, card);
                    ScrollToBottom();
                });
            }
            catch { /* ads must never break chat — any failure just shows no card */ }
        }

        // ── Message builder helpers ──────────────────────────────────────────

        // User turn — right-aligned neutral card (BgCard/BorderSubtle), no avatar.
        private void AppendUserBubble(string text)
        {
            var tb = new TextBlock
            {
                Text = text, FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 20
            };
            tb.SetResourceReference(TextBlock.ForegroundProperty, "TextPrimaryBrush");
            var bubble = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 10, 14, 10),
                MaxWidth = 560,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 0, 0, 16),
                BorderThickness = new Thickness(1),
                Child = tb
            };
            // SetResourceReference (not a FindResource snapshot) so bubbles already
            // on screen repaint when the theme is toggled at runtime.
            bubble.SetResourceReference(Border.BackgroundProperty, "BgCardBrush");
            bubble.SetResourceReference(Border.BorderBrushProperty, "BorderSubtleBrush");

            // Insert before typing row (last child)
            MessagesPanel.Children.Insert(MessagesPanel.Children.Count - 1, bubble);
            ScrollToBottom();
        }

        // Assistant turn — left-aligned card matching the website's assistant bubble
        // (rounded, bg-card, hairline border). Its content StackPanel holds a live
        // plaintext preview during streaming, replaced by rendered HTML on "done".
        private void AppendAiBubbleStart(out StackPanel content, out TextBlock streamBlock)
        {
            streamBlock = new TextBlock
            {
                FontSize = 13.5, TextWrapping = TextWrapping.Wrap,
                LineHeight = 21
            };
            streamBlock.SetResourceReference(TextBlock.ForegroundProperty, "TextPrimaryBrush");
            var panel = new StackPanel();
            panel.Children.Add(streamBlock);
            content = panel;

            var bubble = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 10, 14, 10),
                MaxWidth = 620,
                HorizontalAlignment = HorizontalAlignment.Left,
                Margin = new Thickness(0, 0, 0, 16),
                BorderThickness = new Thickness(1),
                Child = panel
            };
            bubble.SetResourceReference(Border.BackgroundProperty, "BgCardBrush");
            bubble.SetResourceReference(Border.BorderBrushProperty, "BorderSubtleBrush");
            MessagesPanel.Children.Insert(MessagesPanel.Children.Count - 1, bubble);
        }

        private void AppendAiError(string msg)
        {
            var tb = new TextBlock
            {
                Text = msg, FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                LineHeight = 20, Margin = new Thickness(0, 0, 0, 18)
            };
            tb.SetResourceReference(TextBlock.ForegroundProperty, "RedBrush");
            MessagesPanel.Children.Insert(MessagesPanel.Children.Count - 1, tb);
            ScrollToBottom();
        }

        private void ScrollToBottom() => MessagesScroll.ScrollToBottom();
    }
}
