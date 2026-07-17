using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
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
        private TextBlock? _liveBlock;
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

            Dispatcher.Invoke(() =>
            {
                EmptyState.Visibility = Visibility.Collapsed;
                foreach (var (role, content) in loaded)
                {
                    if (role == "user")
                    {
                        AppendUserBubble(content);
                    }
                    else
                    {
                        AppendAiBubbleStart(out var tb);
                        tb.Text = Controls.HtmlToWpf.PlainText(content);
                    }
                    _history.Add((role, content));
                }
                StudyScroll.ScrollToBottom();
            });
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
            if (string.IsNullOrEmpty(text) || _isStreaming) return;

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
                                    AppendAiBubbleStart(out _liveBlock);
                                    StudyStatusLabel.Text = "Answering…";
                                }
                                _liveBlock.Text = _liveText;
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
                });
            }
        }

        private void FinishStream(string fullText)
        {
            StudyTypingRow.Visibility = Visibility.Collapsed;
            if (!string.IsNullOrEmpty(fullText))
                _history.Add(("assistant", fullText));
            _isStreaming = false;
            StudyButton.IsEnabled = true;
            StudyStatusLabel.Text = "Ready";
            StudyScroll.ScrollToBottom();
        }

        // User turn — right-aligned neutral card, no avatar.
        private void AppendUserBubble(string text)
        {
            var bubble = new Border
            {
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 10, 14, 10),
                MaxWidth = 560,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 16, 0, 0),
                Background = (Brush)FindResource("BgCardBrush"),
                BorderBrush = (Brush)FindResource("BorderSubtleBrush"),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = text, FontSize = 13, TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"), LineHeight = 20
                }
            };
            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, bubble);
            StudyScroll.ScrollToBottom();
        }

        // Assistant turn — left-aligned formatted text, no card, no avatar.
        private void AppendAiBubbleStart(out TextBlock liveBlock)
        {
            var tb = new TextBlock
            {
                FontSize = 13, TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
                LineHeight = 21, Margin = new Thickness(0, 16, 0, 2)
            };
            liveBlock = tb;
            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, tb);
        }

        private void AppendAiError(string msg)
        {
            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, new TextBlock
            {
                Text = msg, FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("RedBrush"),
                LineHeight = 20, Margin = new Thickness(0, 16, 0, 2)
            });
            StudyScroll.ScrollToBottom();
        }
    }
}
