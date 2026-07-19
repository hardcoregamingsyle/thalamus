using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using ThalamusApp.Services;

namespace ThalamusApp.Modes
{
    public partial class ResearchView : UserControl
    {
        private string? _token;
        private readonly ConvexClient _convex = new();
        private StreamingClient? _streaming;
        private ConversationStore? _store;
        private bool _historyLoaded;
        private bool _isResearching;
        private CancellationTokenSource? _cts;
        private StackPanel? _liveHost;    // report content host (HTML rendered on "done")
        private TextBlock? _liveBlock;    // live plaintext preview shown while streaming
        private string _liveText = "";

        public ResearchView()
        {
            InitializeComponent();
            _streaming = new StreamingClient(_convex);
            _store = new ConversationStore(_convex, "research");
        }

        public void SetToken(string token)
        {
            _token = token;
            _store!.Reset();
            _historyLoaded = false;
            ResearchStatusLabel.Text = "Ready";
            if (!string.IsNullOrEmpty(token))
                _ = LoadHistoryAsync(token);
        }

        // Replay past research queries + reports from the cloud thread.
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
            if (string.IsNullOrEmpty(_token) || _isResearching) return;
            if (_store!.ConversationId == conversationId) return;
            var loaded = await _store.LoadByIdAsync(_token, conversationId);
            _historyLoaded = true;
            Dispatcher.Invoke(() =>
            {
                ClearTranscript();
                ReplayMessages(loaded);
            });
        }

        /// <summary>Drop to a fresh thread — the next query creates a new conversation.</summary>
        public void StartNewConversation()
        {
            if (_isResearching) return;
            _store!.Reset();
            ClearTranscript();
            EmptyState.Visibility = Visibility.Visible;
        }

        // Remove every transcript element except the progress card (first child).
        private void ClearTranscript()
        {
            while (ResearchPanel.Children.Count > 1)
                ResearchPanel.Children.RemoveAt(1);
        }

        private void ReplayMessages(List<(string role, string content)> loaded)
        {
            if (loaded.Count == 0) return;
            EmptyState.Visibility = Visibility.Collapsed;
            foreach (var (role, content) in loaded)
            {
                if (role == "user")
                {
                    AppendQueryHeader(content);
                }
                else
                {
                    AppendResultStart(out var host, out _);
                    Controls.HtmlToWpf.Populate(host, content);
                }
            }
            ResearchScroll.ScrollToBottom();
        }

        private void ResearchInput_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return && Keyboard.Modifiers == ModifierKeys.None)
            {
                e.Handled = true;
                _ = DoResearchAsync();
            }
        }

        private void Research_Click(object sender, RoutedEventArgs e) => _ = DoResearchAsync();

        // Chips prefill the query (matching the website) — the user runs it themselves.
        private void Example_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (sender is Border b && b.Child is TextBlock tb)
            {
                ResearchInputBox.Text = tb.Text;
                ResearchInputBox.Focus();
                ResearchInputBox.CaretIndex = tb.Text.Length;
            }
        }

        private async Task DoResearchAsync()
        {
            var query = ResearchInputBox.Text.Trim();
            if (string.IsNullOrEmpty(query) || _isResearching) return;

            ResearchInputBox.Text = "";
            EmptyState.Visibility = Visibility.Collapsed;

            // Show progress card
            ProgressCard.Visibility = Visibility.Visible;
            ProgressStepLabel.Text = "Searching the web…";
            AnimateProgress(0.3);

            _isResearching = true;
            ResearchButton.IsEnabled = false;
            ResearchStatusLabel.Text = "Researching…";

            // Add query header
            AppendQueryHeader(query);

            _cts = new CancellationTokenSource(TimeSpan.FromSeconds(180));
            _liveText = "";
            _liveHost = null;
            _liveBlock = null;

            bool resultStarted = false;
            bool isFirstExchange = _store!.ConversationId == null;

            try
            {
                // Ensure a cloud conversation so the server persists query + report.
                if (!string.IsNullOrEmpty(_token))
                    await _store!.EnsureAsync(_token, query);

                await _streaming!.StreamChatAsync(
                    query, "research",
                    new List<(string, string)>(),
                    // Same HTML-forcing framing the website sends — without it the
                    // model answers in Markdown and the report renders as raw text.
                    "You are a thorough research assistant. Search the web for current information, " +
                    "synthesize findings from multiple sources, and provide a comprehensive, well-structured " +
                    "report with clear sections and source citations where possible. CRITICAL: respond in " +
                    "clean, semantic HTML only — no Markdown, no plain text, no code fences around the whole " +
                    "reply. Use <h2>/<h3>, <p>, <ul>/<ol>/<li>, <strong>, <em>, <code>, <pre><code>, " +
                    "<blockquote>, <a>, and <table> where appropriate.",
                    _token, _store!.ConversationId,
                    (type, chunk) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (type == "done")
                            {
                                FinishResearch(_liveText, isFirstExchange, query);
                                return;
                            }
                            if (type == "answer")
                            {
                                _liveText += chunk;
                                if (!resultStarted)
                                {
                                    resultStarted = true;
                                    ProgressStepLabel.Text = "Generating report…";
                                    AnimateProgress(0.7);
                                    AppendResultStart(out _liveHost, out _liveBlock);
                                }
                                if (_liveBlock != null)
                                {
                                    // Plain-text preview while streaming; formatted on "done".
                                    _liveBlock.Text = Controls.HtmlToWpf.PlainText(_liveText);
                                    ResearchScroll.ScrollToBottom();
                                }
                            }
                        });
                    },
                    _cts.Token);
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    ProgressCard.Visibility = Visibility.Collapsed;
                    AppendError(ex.Message.Contains("401") || ex.Message.Contains("token")
                        ? "Please sign in to use Research."
                        : "Research failed. Please try again.");
                    _isResearching = false;
                    ResearchButton.IsEnabled = true;
                    ResearchStatusLabel.Text = "Error";
                });
            }
        }

        private void FinishResearch(string fullText, bool isFirstExchange, string query)
        {
            ProgressCard.Visibility = Visibility.Collapsed;
            if (!string.IsNullOrEmpty(fullText))
            {
                // Replace the plaintext preview with the rendered HTML report.
                if (_liveHost == null)
                    AppendResultStart(out _liveHost, out _liveBlock);
                Controls.HtmlToWpf.Populate(_liveHost, fullText);
            }
            _isResearching = false;
            ResearchButton.IsEnabled = true;
            ResearchStatusLabel.Text = "Done";
            ResearchScroll.ScrollToBottom();

            // Keep the sidebar honest (balance + RECENT) and title the thread
            // after its first exchange, exactly like the website does.
            if (!string.IsNullOrEmpty(fullText) && !string.IsNullOrEmpty(_token))
            {
                if (isFirstExchange)
                    _ = _store!.GenerateTitleAsync(_token, query);
                (Window.GetWindow(this) as MainWindow)?.NotifyExchangeCompleted();
            }
        }

        private void AnimateProgress(double toFraction)
        {
            // Animate the progress bar width relative to container
            ProgressCard.UpdateLayout();
            double targetWidth = ProgressCard.ActualWidth * 0.9 * toFraction;
            if (targetWidth <= 0) return;
            var anim = new DoubleAnimation(targetWidth, TimeSpan.FromMilliseconds(600))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            ProgressFill.BeginAnimation(WidthProperty, anim);
        }

        // The query the user asked — right-aligned neutral card, no avatar.
        private void AppendQueryHeader(string query)
        {
            var bubble = new Border
            {
                Background = (Brush)FindResource("BgCardBrush"),
                BorderBrush = (Brush)FindResource("BorderSubtleBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 10, 14, 10),
                MaxWidth = 560,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 0, 0, 16),
                Child = new TextBlock
                {
                    Text = query,
                    FontSize = 13, FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                    TextWrapping = TextWrapping.Wrap
                }
            };
            ResearchPanel.Children.Add(bubble);
        }

        // The report — left-aligned prose, no card, no avatar. The host panel
        // carries a plaintext preview while streaming and is repopulated with
        // rendered HTML (HtmlToWpf) on "done" / replay.
        private void AppendResultStart(out StackPanel host, out TextBlock liveBlock)
        {
            var tb = new TextBlock
            {
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
                LineHeight = 21
            };
            liveBlock = tb;
            var panel = new StackPanel { Margin = new Thickness(0, 0, 0, 18) };
            panel.Children.Add(tb);
            host = panel;
            ResearchPanel.Children.Add(panel);
        }

        private void AppendError(string msg)
        {
            ResearchPanel.Children.Add(new TextBlock
            {
                Text = msg, FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("RedBrush"),
                LineHeight = 20, Margin = new Thickness(0, 0, 0, 18)
            });
        }
    }
}
