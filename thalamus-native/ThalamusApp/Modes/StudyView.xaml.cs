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
        private CancellationTokenSource? _cts;
        private bool _isStreaming;
        private TextBlock? _liveBlock;
        private string _liveText = "";

        public StudyView()
        {
            InitializeComponent();
            _streaming = new StreamingClient(_convex);
        }

        public void SetToken(string token)
        {
            _token = token;
            StudyStatusLabel.Text = "Ready";
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

        private void StudyExample_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (sender is Border b && b.Child is TextBlock tb)
            {
                // Strip emoji
                var text = tb.Text;
                var parts = text.Split("  ");
                StudyInputBox.Text = parts.Length > 1 ? $"Explain {parts[1]} to me" : text;
                _ = SendStudyAsync();
            }
        }

        private async Task SendStudyAsync()
        {
            var text = StudyInputBox.Text.Trim();
            if (string.IsNullOrEmpty(text) || _isStreaming) return;

            StudyInputBox.Text = "";
            StudyWelcomeCard.Visibility = Visibility.Collapsed;

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
                await _streaming!.StreamChatAsync(
                    text, "study", _history, systemPrompt, _token, null,
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

        private void AppendUserBubble(string text)
        {
            var row = new Grid { Margin = new Thickness(0, 16, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });

            var grad = new LinearGradientBrush
            {
                StartPoint = new System.Windows.Point(0, 0),
                EndPoint = new System.Windows.Point(1, 1)
            };
            grad.GradientStops.Add(new GradientStop(Color.FromRgb(0x1a, 0x0c, 0x3e), 0));
            grad.GradientStops.Add(new GradientStop(Color.FromRgb(0x14, 0x08, 0x32), 1));

            var bubble = new Border
            {
                CornerRadius = new CornerRadius(12, 4, 12, 12),
                Padding = new Thickness(14, 10, 14, 10),
                MaxWidth = 520,
                HorizontalAlignment = HorizontalAlignment.Right,
                Background = grad,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x3d, 0x1a, 0x78)),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"), LineHeight = 19
                }
            };
            Grid.SetColumn(bubble, 0);
            row.Children.Add(bubble);

            var avatar = new Border
            {
                Width = 28, Height = 28, CornerRadius = new CornerRadius(7),
                VerticalAlignment = VerticalAlignment.Top,
                Background = new SolidColorBrush(Color.FromRgb(0x1a, 0x0c, 0x3e)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x3d, 0x1a, 0x78)),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = "U", FontSize = 11, FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("PurpleBrush"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
            Grid.SetColumn(avatar, 2);
            row.Children.Add(avatar);

            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, row);
            StudyScroll.ScrollToBottom();
        }

        private void AppendAiBubbleStart(out TextBlock liveBlock)
        {
            var row = new Grid { Margin = new Thickness(0, 16, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(32) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var avatarGrad = new LinearGradientBrush
            {
                StartPoint = new System.Windows.Point(0, 0),
                EndPoint = new System.Windows.Point(1, 1)
            };
            avatarGrad.GradientStops.Add(new GradientStop(Color.FromRgb(0x43, 0x38, 0xca), 0));
            avatarGrad.GradientStops.Add(new GradientStop(Color.FromRgb(0x8b, 0x5c, 0xf6), 1));

            var avatarBorder = new Border
            {
                Width = 32, Height = 32, CornerRadius = new CornerRadius(8),
                VerticalAlignment = VerticalAlignment.Top, Background = avatarGrad,
                Child = new TextBlock
                {
                    Text = "T", FontSize = 13, FontWeight = FontWeights.Black, Foreground = Brushes.White,
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
                }
            };
            Grid.SetColumn(avatarBorder, 0);
            row.Children.Add(avatarBorder);

            var tb = new TextBlock
            {
                FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextSecondaryBrush"), LineHeight = 19
            };
            liveBlock = tb;

            var bubble = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x0a, 0x16, 0x28)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x1e, 0x3a, 0x5f)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4, 12, 12, 12),
                Padding = new Thickness(14, 10, 14, 10),
                Child = tb
            };
            Grid.SetColumn(bubble, 2);
            row.Children.Add(bubble);

            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, row);
        }

        private void AppendAiError(string msg)
        {
            var row = new Grid { Margin = new Thickness(0, 16, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(32) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var avatarBorder = new Border
            {
                Width = 32, Height = 32, CornerRadius = new CornerRadius(8),
                VerticalAlignment = VerticalAlignment.Top,
                Background = new SolidColorBrush(Color.FromRgb(0x2a, 0x10, 0x10)),
                Child = new TextBlock
                {
                    Text = "!", FontSize = 14, FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("RedBrush"),
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
                }
            };
            Grid.SetColumn(avatarBorder, 0);
            row.Children.Add(avatarBorder);

            var bubble = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x1a, 0x08, 0x08)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x4a, 0x10, 0x10)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4, 12, 12, 12),
                Padding = new Thickness(14, 10, 14, 10),
                Child = new TextBlock
                {
                    Text = msg, FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("RedBrush"), LineHeight = 19
                }
            };
            Grid.SetColumn(bubble, 2);
            row.Children.Add(bubble);

            StudyPanel.Children.Insert(StudyPanel.Children.Count - 1, row);
            StudyScroll.ScrollToBottom();
        }
    }
}
