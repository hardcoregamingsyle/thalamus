using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using ThalamusApp.Services;

namespace ThalamusApp.Modes
{
    public partial class StudyView : UserControl
    {
        private string? _token;
        private string _studyMode = "tutor";
        private readonly ConvexClient _convex = new();
        private StreamingClient? _streaming;
        private readonly List<(string role, string text)> _history = new();
        private ConversationStore? _store;
        private bool _historyLoaded;
        private CancellationTokenSource? _cts;
        private bool _isStreaming;
        private bool _isOpening;     // a RECENT open is fetching — block sends until it lands
        private bool _pendingReset;  // "+ New"/delete arrived mid-stream — reset when it ends
        private StackPanel? _liveContent;   // assistant content host (HTML rendered on "done")
        private TextBlock? _liveBlock;      // live plaintext preview shown while streaming
        private string _liveText = "";

        public StudyView()
        {
            InitializeComponent();
            _streaming = new StreamingClient(_convex);
            _store = new ConversationStore(_convex, "study");
        }

        public void SetToken(string token)
        {
            _token = token;
            _store!.Reset();
            _historyLoaded = false;
            StudyStatusLabel.Text = "Ready";
            if (!string.IsNullOrEmpty(token))
                _ = LoadHistoryAsync(token);
        }

        // Replay the newest cloud study thread so sessions survive restarts.
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
            ClearTranscript();
            EmptyState.Visibility = Visibility.Visible;
        }

        // Remove every transcript element except the typing row (last child).
        private void ClearTranscript()
        {
            _history.Clear();
            while (StudyPanel.Children.Count > 1)
                StudyPanel.Children.RemoveAt(0);
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
                    Controls.HtmlToWpf.Populate(host, content);
                }
                _history.Add((role, content));
            }
            StudyScroll.ScrollToBottom();
        }

        private void StudyMode_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string tag) return;
            _studyMode = tag;
            var inactive = (Style)FindResource("ModeToggleBtn");
            var active   = (Style)FindResource("ModeToggleBtnActive");
            TBtn_Tutor.Style   = tag == "tutor"   ? active : inactive;
            TBtn_Quiz.Style    = tag == "quiz"     ? active : inactive;
            TBtn_Solve.Style   = tag == "solve"    ? active : inactive;
            TBtn_Summary.Style = tag == "summary"  ? active : inactive;

            StudyInputBox.Focus();
        }

        private void StudyInput_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return && Keyboard.Modifiers == ModifierKeys.None)
            {
                e.Handled = true;
                _ = SendStudyAsync();
            }
        }

        private void Study_Click(object sender, RoutedEventArgs e) => _ = SendStudyAsync();

        // Chips prefill the input (matching the website) rather than auto-sending.
        private void StudyExample_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (sender is Border b && b.Child is TextBlock tb)
            {
                StudyInputBox.Text = tb.Text;
                StudyInputBox.Focus();
                StudyInputBox.CaretIndex = tb.Text.Length;
            }
        }

        private async Task SendStudyAsync()
        {
            var text = StudyInputBox.Text.Trim();
            if (string.IsNullOrEmpty(text) || _isStreaming || _isOpening) return;

            StudyInputBox.Text = "";
            EmptyState.Visibility = Visibility.Collapsed;

            AppendUserBubble(text);
            _history.Add(("user", text));

            StudyTypingRow.Visibility = Visibility.Visible;
            StudyScroll.ScrollToBottom();

            _isStreaming = true;
            StudyButton.IsEnabled = false;
            StudyStatusLabel.Text = "Thinking…";

            _cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
            _liveText = "";
            _liveContent = null;
            _liveBlock = null;

            var systemPrompt = _studyMode switch
            {
                "quiz" => "You are a patient quiz master. Create a short quiz (3-5 questions) based on the topic the student mentions. Ask one question at a time, wait for the answer, then give feedback and the next question.",
                "solve" => "You are a step-by-step problem solver. Break down solutions into clearly numbered steps. Show all working. Explain each step simply.",
                "summary" => "You are a concise summariser. Take the topic or text and produce a clear, structured summary with key points, key definitions, and a brief conclusion.",
                _ => "You are a patient, encouraging tutor. Explain concepts clearly using simple language and concrete examples. Check for understanding and adapt to the student's level."
            };

            try
            {
                // Ensure a cloud conversation so the server persists both turns.
                if (!string.IsNullOrEmpty(_token))
                    await _store!.EnsureAsync(_token, text);

                await _streaming!.StreamChatAsync(
                    text, "study", _history, systemPrompt, _token, _store!.ConversationId,
                    (type, chunk) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (type == "done")
                            {
                                FinishStream(_liveText);
                                return;
                            }
                            if (type == "answer")
                            {
                                _liveText += chunk;
                                if (_liveBlock == null)
                                {
                                    StudyTypingRow.Visibility = Visibility.Collapsed;
                                    AppendAiBubbleStart(out _liveContent, out _liveBlock);
                                    StudyStatusLabel.Text = "Answering…";
                                }
                                // Plain-text preview while streaming — the HTML can't be
                                // rendered mid-stream (unclosed tags); formatted on "done".
                                _liveBlock!.Text = Controls.HtmlToWpf.PlainText(_liveText);
                                StudyScroll.ScrollToBottom();
                            }
                        });
                    },
                    _cts.Token);
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    StudyTypingRow.Visibility = Visibility.Collapsed;
                    AppendAiError(ex.Message.Contains("401") || ex.Message.Contains("token")
                        ? "Please sign in to use Study mode."
                        : "Something went wrong. Please try again.");
                    _isStreaming = false;
                    StudyButton.IsEnabled = true;
                    StudyStatusLabel.Text = "Error";
                    if (_pendingReset) { _pendingReset = false; StartNewConversation(); }
                });
            }
        }

        private void FinishStream(string fullText)
        {
            StudyTypingRow.Visibility = Visibility.Collapsed;
            if (!string.IsNullOrEmpty(fullText))
            {
                // Replace the plaintext preview with the rendered HTML.
                if (_liveContent == null)
                    AppendAiBubbleStart(out _liveContent, out _liveBlock);
                Controls.HtmlToWpf.Populate(_liveContent, fullText);
                _history.Add(("assistant", fullText));
            }
            _isStreaming = false;
            StudyButton.IsEnabled = true;
            StudyStatusLabel.Text = "Ready";
            StudyScroll.ScrollToBottom();

            // Keep the sidebar honest (balance + RECENT) and title the thread
            // after its first exchange, exactly like the website does.
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

        // User turn — right-aligned neutral card, no avatar.
        private void AppendUserBubble(string text)
        {
            var tb = new TextBlock
            {
                Text = text, FontSize = 13, TextWrapping = TextWrapping.Wrap,
                LineHeight = 20
            };
            tb.SetResourceReference(TextBlock.ForegroundProperty, "TextPrimaryBrush");
            var bubble = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 10, 14, 10),
                MaxWidth = 560,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 16, 0, 0),
                BorderThickness = new Thickness(1),
                Child = tb
            };
            // SetResourceReference so bubbles already on screen follow a runtime theme toggle.
            bubble.SetResourceReference(Border.BackgroundProperty, "BgCardBrush");
            bubble.SetResourceReference(Border.BorderBrushProperty, "BorderSubtleBrush");
            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, bubble);
            StudyScroll.ScrollToBottom();
        }

        // Assistant turn — left-aligned formatted content, no card, no avatar.
        // The host StackPanel carries a plaintext preview while streaming and is
        // repopulated with rendered HTML (HtmlToWpf) on "done" / replay.
        private void AppendAiBubbleStart(out StackPanel content, out TextBlock streamBlock)
        {
            streamBlock = new TextBlock
            {
                FontSize = 13, TextWrapping = TextWrapping.Wrap,
                LineHeight = 21
            };
            streamBlock.SetResourceReference(TextBlock.ForegroundProperty, "TextPrimaryBrush");
            var panel = new StackPanel { Margin = new Thickness(0, 16, 0, 2) };
            panel.Children.Add(streamBlock);
            content = panel;
            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, panel);
        }

        private void AppendAiError(string msg)
        {
            var tb = new TextBlock
            {
                Text = msg, FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                LineHeight = 20, Margin = new Thickness(0, 16, 0, 2)
            };
            tb.SetResourceReference(TextBlock.ForegroundProperty, "RedBrush");
            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, tb);
            StudyScroll.ScrollToBottom();
        }
    }
}
