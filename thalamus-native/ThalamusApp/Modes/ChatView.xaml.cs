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
    public partial class ChatView : UserControl
    {
        private string? _token;
        private string _model = "sonnet";
        private readonly ConvexClient _convex = new();
        private StreamingClient? _streaming;
        private readonly List<(string role, string text)> _history = new();
        private CancellationTokenSource? _cts;
        private bool _isStreaming;
        private TextBlock? _liveBlock;
        private string _liveText = "";

        public ChatView()
        {
            InitializeComponent();
            _streaming = new StreamingClient(_convex);
        }

        public void SetToken(string token)
        {
            _token = token;
            ChatCreditsLabel.Text = "Signed in";
        }

        private void Pill_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string tag) return;
            _model = tag;
            var inactive = (Style)FindResource("ModelPill");
            var active   = (Style)FindResource("ModelPillActive");
            PillSonnet.Style = tag == "sonnet" ? active : inactive;
            PillOpus.Style   = tag == "opus"   ? active : inactive;
            PillHaiku.Style  = tag == "haiku"  ? active : inactive;
            PillGemini.Style = tag == "gemini" ? active : inactive;
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

        private async Task SendAsync()
        {
            var text = ChatInputBox.Text.Trim();
            if (string.IsNullOrEmpty(text) || _isStreaming) return;

            ChatInputBox.Text = "";
            WelcomeMsg.Visibility = Visibility.Collapsed;

            AppendUserBubble(text);
            _history.Add(("user", text));

            TypingRow.Visibility = Visibility.Visible;
            ScrollToBottom();

            _isStreaming = true;
            SendButton.IsEnabled = false;
            StreamingLabel.Text = "Thinking…";
            _cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
            _liveText = "";
            _liveBlock = null;

            var modeStr = _model switch
            {
                "opus"   => "chat-opus",
                "haiku"  => "chat-haiku",
                "gemini" => "chat-gemini",
                _        => "chat"
            };

            try
            {
                await _streaming!.StreamChatAsync(
                    text, modeStr, _history,
                    "You are Thalamus AI, a highly capable and helpful AI assistant. Be concise, clear, and accurate.",
                    _token, null,
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
                                    TypingRow.Visibility = Visibility.Collapsed;
                                    AppendAiBubbleStart(out _liveBlock);
                                    StreamingLabel.Text = "Generating…";
                                }
                                _liveBlock.Text = _liveText;
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
                    StreamingLabel.Text = "";
                });
            }
        }

        private void FinishStream(string fullText)
        {
            TypingRow.Visibility = Visibility.Collapsed;
            if (!string.IsNullOrEmpty(fullText))
                _history.Add(("assistant", fullText));
            _isStreaming = false;
            SendButton.IsEnabled = true;
            StreamingLabel.Text = "";
            ScrollToBottom();
        }

        // ── Message builder helpers ──────────────────────────────────────────

        private void AppendUserBubble(string text)
        {
            var row = new Grid { Margin = new Thickness(0, 0, 0, 16) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });

            var grad = new LinearGradientBrush();
            grad.GradientStops.Add(new GradientStop(Color.FromRgb(0x0d, 0x2b, 0x5c), 0));
            grad.GradientStops.Add(new GradientStop(Color.FromRgb(0x0f, 0x23, 0x46), 1));
            grad.StartPoint = new System.Windows.Point(0, 0);
            grad.EndPoint = new System.Windows.Point(1, 1);

            var bubble = new Border
            {
                CornerRadius = new CornerRadius(12, 4, 12, 12),
                Padding = new Thickness(14, 10, 14, 10),
                MaxWidth = 520,
                HorizontalAlignment = HorizontalAlignment.Right,
                Background = grad,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x1e, 0x4a, 0x8f)),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = text, FontSize = 12.5,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                    LineHeight = 19
                }
            };
            Grid.SetColumn(bubble, 0);
            row.Children.Add(bubble);

            var avatar = new Border
            {
                Width = 28, Height = 28, CornerRadius = new CornerRadius(7),
                VerticalAlignment = VerticalAlignment.Top,
                Background = new SolidColorBrush(Color.FromRgb(0x0d, 0x2b, 0x5c)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x1e, 0x4a, 0x8f)),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = "U", FontSize = 11, FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("BlueBrush"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
            Grid.SetColumn(avatar, 2);
            row.Children.Add(avatar);

            // Insert before typing row (last child)
            MessagesPanel.Children.Insert(MessagesPanel.Children.Count - 1, row);
            ScrollToBottom();
        }

        private void AppendAiBubbleStart(out TextBlock liveBlock)
        {
            var row = new Grid { Margin = new Thickness(0, 0, 0, 16) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(32) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var avatarGrad = new LinearGradientBrush();
            avatarGrad.GradientStops.Add(new GradientStop(Color.FromRgb(0x3b, 0x82, 0xf6), 0));
            avatarGrad.GradientStops.Add(new GradientStop(Color.FromRgb(0x63, 0x66, 0xf1), 1));
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

            MessagesPanel.Children.Insert(MessagesPanel.Children.Count - 1, row);
        }

        private void AppendAiError(string msg)
        {
            var row = new Grid { Margin = new Thickness(0, 0, 0, 16) };
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

            MessagesPanel.Children.Insert(MessagesPanel.Children.Count - 1, row);
            ScrollToBottom();
        }

        private void ScrollToBottom() => MessagesScroll.ScrollToBottom();
    }
}
