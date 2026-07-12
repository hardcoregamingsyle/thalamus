using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using ThalamusApp.Services;

namespace ThalamusApp.Modes
{
    public partial class CodeView : UserControl
    {
        private string? _token;
        private readonly ConvexClient _convex = new();
        private StreamingClient? _streaming;
        private CancellationTokenSource? _cts;
        private bool _isBuilding;
        private TextBlock? _liveBlock;
        private string _liveText = "";

        private static readonly string[] AgentNames =
        {
            "Researcher", "Analyser", "Planner", "Coder",
            "Optimiser", "Organizer", "Tester", "Hacker", "Critic"
        };

        public CodeView()
        {
            InitializeComponent();
            _streaming = new StreamingClient(_convex);
        }

        public void SetToken(string token)
        {
            _token = token;
            BuildStatusLabel.Text = "Ready";
        }

        private void BuildInput_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return && Keyboard.Modifiers == ModifierKeys.None)
            {
                e.Handled = true;
                _ = StartBuildAsync();
            }
        }

        private void Build_Click(object sender, RoutedEventArgs e) => _ = StartBuildAsync();

        // Chips prefill the input (matching the website) rather than auto-building.
        private void BuildExample_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (sender is Border b && b.Child is TextBlock tb)
            {
                BuildInputBox.Text = tb.Text;
                BuildInputBox.Focus();
                BuildInputBox.CaretIndex = tb.Text.Length;
            }
        }

        private async Task StartBuildAsync()
        {
            var prompt = BuildInputBox.Text.Trim();
            if (string.IsNullOrEmpty(prompt) || _isBuilding) return;

            BuildInputBox.Text = "";
            EmptyState.Visibility = Visibility.Collapsed;

            // Show project brief
            AppendProjectBrief(prompt);

            // Show pipeline card
            AgentProgressCard.Visibility = Visibility.Visible;
            AgentStageLabel.Text = "Starting pipeline…";
            RenderAgentDots(0);

            _isBuilding = true;
            BuildButton.IsEnabled = false;
            BuildStatusLabel.Text = "Building…";
            BuildStatusDot.Fill = (Brush)FindResource("AmberBrush");

            _cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
            _liveText = "";
            _liveBlock = null;

            int currentAgent = 0;

            try
            {
                await _streaming!.StreamChatAsync(
                    prompt, "build",
                    new List<(string, string)>(),
                    "You are the Thalamus 9-agent autonomous software pipeline. Build the requested project comprehensively. Include: architecture overview, key files with complete code, setup instructions, and a summary of what was built.",
                    _token, null,
                    (type, chunk) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (type == "done")
                            {
                                FinishBuild(_liveText);
                                return;
                            }
                            if (type == "thinking" && _liveText.Length == 0)
                            {
                                // Update agent stage from thinking content
                                if (currentAgent < AgentNames.Length)
                                {
                                    AgentStageLabel.Text = $"Agent {currentAgent + 1}: {AgentNames[currentAgent]}";
                                    RenderAgentDots(currentAgent + 1);
                                    currentAgent++;
                                }
                                return;
                            }
                            if (type == "answer")
                            {
                                _liveText += chunk;
                                if (_liveBlock == null)
                                {
                                    // Final output section
                                    currentAgent = AgentNames.Length;
                                    AgentStageLabel.Text = "Generating output…";
                                    RenderAgentDots(AgentNames.Length);
                                    AppendOutputStart(out _liveBlock);
                                }
                                _liveBlock.Text = _liveText;
                                BuildScroll.ScrollToBottom();
                            }
                        });
                    },
                    _cts.Token);
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    AgentProgressCard.Visibility = Visibility.Collapsed;
                    AppendBuildError(ex.Message.Contains("401") || ex.Message.Contains("token")
                        ? "Please sign in to use Build mode."
                        : "Build failed. Please try again.");
                    _isBuilding = false;
                    BuildButton.IsEnabled = true;
                    BuildStatusLabel.Text = "Error";
                    BuildStatusDot.Fill = (Brush)FindResource("RedBrush");
                });
            }
        }

        private void FinishBuild(string fullText)
        {
            AgentProgressCard.Visibility = Visibility.Collapsed;
            AppendSuccessBanner();
            _isBuilding = false;
            BuildButton.IsEnabled = true;
            BuildStatusLabel.Text = "Done";
            BuildStatusDot.Fill = (Brush)FindResource("GreenBrush");
            BuildScroll.ScrollToBottom();
        }

        private void RenderAgentDots(int completedCount)
        {
            AgentDots.Items.Clear();
            for (int i = 0; i < AgentNames.Length; i++)
            {
                bool done = i < completedCount;
                bool active = i == completedCount - 1;

                var container = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Margin = new Thickness(0, 0, 10, 4),
                    VerticalAlignment = VerticalAlignment.Center
                };

                var dot = new Ellipse
                {
                    Width = 6, Height = 6,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 4, 0)
                };

                if (done)
                    dot.Fill = (Brush)FindResource("GreenBrush");
                else if (active)
                    dot.Fill = (Brush)FindResource("AmberBrush");
                else
                    dot.Fill = new SolidColorBrush(Color.FromRgb(0x1e, 0x3a, 0x5f));

                var label = new TextBlock
                {
                    Text = AgentNames[i],
                    FontSize = 9.5,
                    Foreground = done
                        ? (Brush)FindResource("GreenBrush")
                        : active
                            ? (Brush)FindResource("AmberBrush")
                            : (Brush)FindResource("TextMutedBrush"),
                    VerticalAlignment = VerticalAlignment.Center
                };

                container.Children.Add(dot);
                container.Children.Add(label);
                AgentDots.Items.Add(container);
            }
        }

        // The build request — right-aligned neutral card, no avatar.
        private void AppendProjectBrief(string prompt)
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
                    Text = prompt,
                    FontSize = 13, FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                    TextWrapping = TextWrapping.Wrap
                }
            };
            BuildPanel.Children.Add(bubble);
        }

        // The pipeline output is code — keep it in a monospace "output" panel that
        // reads like a build log rather than a chat bubble.
        private void AppendOutputStart(out TextBlock liveBlock)
        {
            var border = new Border
            {
                Background = (Brush)FindResource("BgInputBrush"),
                BorderBrush = (Brush)FindResource("BorderSubtleBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(18, 14, 18, 14),
                Margin = new Thickness(0, 0, 0, 16)
            };

            var tb = new TextBlock
            {
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(Color.FromRgb(0x6e, 0xe7, 0xb7)),
                LineHeight = 19,
                FontFamily = (FontFamily)FindResource("MonoFontFamily")
            };
            liveBlock = tb;
            border.Child = tb;
            BuildPanel.Children.Add(border);
        }

        private void AppendSuccessBanner()
        {
            var border = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x06, 0x1a, 0x0e)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x10, 0x5c, 0x2a)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 12, 0, 16)
            };
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            sp.Children.Add(new Ellipse
            {
                Width = 8, Height = 8,
                Fill = (Brush)FindResource("GreenBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 10, 0)
            });
            sp.Children.Add(new TextBlock
            {
                Text = "Build complete — 9 agents finished",
                FontSize = 12.5, FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("GreenBrush"),
                VerticalAlignment = VerticalAlignment.Center
            });
            border.Child = sp;
            BuildPanel.Children.Add(border);
        }

        private void AppendBuildError(string msg)
        {
            var border = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x1a, 0x08, 0x08)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x4a, 0x10, 0x10)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 0, 0, 12),
                Child = new TextBlock
                {
                    Text = msg, FontSize = 12.5, TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("RedBrush")
                }
            };
            BuildPanel.Children.Add(border);
            BuildScroll.ScrollToBottom();
        }
    }
}
