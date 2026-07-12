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
        private bool _isResearching;
        private CancellationTokenSource? _cts;
        private TextBlock? _liveBlock;
        private string _liveText = "";

        public ResearchView()
        {
            InitializeComponent();
            _streaming = new StreamingClient(_convex);
        }

        public void SetToken(string token)
        {
            _token = token;
            ResearchStatusLabel.Text = "Ready";
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
            _liveBlock = null;

            bool resultStarted = false;

            try
            {
                await _streaming!.StreamChatAsync(
                    query, "research",
                    new List<(string, string)>(),
                    "You are a thorough research assistant. Search the web for current information, synthesize findings from multiple sources, and provide a comprehensive, well-structured report with clear sections and source citations where possible.",
                    _token, null,
                    (type, chunk) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (type == "done")
                            {
                                FinishResearch(_liveText);
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
                                    AppendResultStart(out _liveBlock);
                                }
                                if (_liveBlock != null)
                                {
                                    _liveBlock.Text = _liveText;
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

        private void FinishResearch(string fullText)
        {
            ProgressCard.Visibility = Visibility.Collapsed;
            _isResearching = false;
            ResearchButton.IsEnabled = true;
            ResearchStatusLabel.Text = "Done";
            ResearchScroll.ScrollToBottom();
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

        // The report — left-aligned prose, no card, no avatar.
        private void AppendResultStart(out TextBlock liveBlock)
        {
            var tb = new TextBlock
            {
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
                LineHeight = 21,
                Margin = new Thickness(0, 0, 0, 18)
            };
            liveBlock = tb;
            ResearchPanel.Children.Add(tb);
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
