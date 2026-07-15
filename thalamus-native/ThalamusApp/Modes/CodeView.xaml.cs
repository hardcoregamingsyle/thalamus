using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
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
    // Build mode — runs the REAL code pipeline (codeProjects/codeBranches/
    // codePipeline on Convex), the same backend the website's /portal/code uses.
    // Each build creates a project + branch, starts the pipeline, then polls the
    // branch for agent progress, messages, streaming output and the code files
    // the agents write. No fake progress: every dot on screen is a real agent.
    public partial class CodeView : UserControl
    {
        private string? _token;
        private readonly ConvexClient _convex = new();
        private CancellationTokenSource? _cts;
        private bool _isBuilding;

        // Full pipeline in canonical order — used until the Dispatcher reports
        // which subset it actually picked for this task.
        private static readonly string[] AllAgents =
        {
            "Researcher", "Analyser", "Planner", "Coder",
            "Optimiser", "Organizer", "Tester", "Hacker", "Critic"
        };

        private const int PollMs = 1500;
        private static readonly TimeSpan BuildTimeout = TimeSpan.FromMinutes(20);

        public CodeView()
        {
            InitializeComponent();
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

            if (string.IsNullOrEmpty(_token))
            {
                AppendBuildError("Please sign in to use Build mode.");
                return;
            }

            BuildInputBox.Text = "";
            EmptyState.Visibility = Visibility.Collapsed;
            AppendProjectBrief(prompt);

            AgentProgressCard.Visibility = Visibility.Visible;
            AgentStageLabel.Text = "Creating project…";
            RenderAgentDots(AllAgents, currentAgent: null, allDone: false);

            _isBuilding = true;
            BuildButton.IsEnabled = false;
            BuildStatusLabel.Text = "Building…";
            BuildStatusDot.Fill = (Brush)FindResource("AmberBrush");

            _cts = new CancellationTokenSource(BuildTimeout);

            try
            {
                // 1. Project + main branch (server auto-creates "main")
                var projectName = prompt.Length > 48 ? prompt[..48] : prompt;
                var created = await _convex.CallMutationAsync("codeProjects:createProject",
                    new { token = _token, name = projectName, description = prompt }, _token);
                var branchId = created?["branchId"]?.GetValue<string>()
                    ?? throw new Exception("Project creation returned no branch");

                // 2. Kick off the real pipeline
                await _convex.CallActionAsync("codePipeline:startPipeline",
                    new { token = _token, branchId, userPrompt = prompt }, _token);

                // 3. Poll the branch until the pipeline completes
                await PollPipelineAsync(branchId, _cts.Token);
            }
            catch (OperationCanceledException)
            {
                AgentProgressCard.Visibility = Visibility.Collapsed;
                AppendBuildError("Build timed out. The pipeline may still be running — check your projects on the website.");
                SetIdle("Timeout", error: true);
            }
            catch (Exception ex)
            {
                AgentProgressCard.Visibility = Visibility.Collapsed;
                AppendBuildError(ex.Message.Contains("401") || ex.Message.Contains("authenticated")
                    ? "Please sign in to use Build mode."
                    : $"Build failed: {ex.Message}");
                SetIdle("Error", error: true);
            }
        }

        private async Task PollPipelineAsync(string branchId, CancellationToken ct)
        {
            int renderedMessages = 0;
            string[] pipelineAgents = AllAgents;
            TextBlock? liveBlock = null;
            Border? liveBorder = null;

            while (true)
            {
                ct.ThrowIfCancellationRequested();

                var branch = await _convex.CallQueryAsync("codeBranches:getBranch",
                    new { token = _token!, branchId }, _token);
                if (branch == null) throw new Exception("Branch disappeared");

                var status = branch["status"]?.GetValue<string>() ?? "idle";
                var currentAgent = branch["currentAgent"]?.GetValue<string>();

                // Dynamic pipeline: once the Dispatcher has picked agents, only
                // show those. (dispatchedAgentsJson is set right after dispatch.)
                var dispatchedJson = branch["dispatchedAgentsJson"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(dispatchedJson))
                {
                    try
                    {
                        var picked = new List<string>();
                        var arr = JsonNode.Parse(dispatchedJson) as JsonArray;
                        if (arr != null)
                            foreach (var a in arr)
                            {
                                var name = a?.GetValue<string>();
                                if (name != null) picked.Add(name);
                            }
                        if (picked.Count > 0)
                        {
                            var ordered = new List<string>();
                            foreach (var a in AllAgents) if (picked.Contains(a)) ordered.Add(a);
                            pipelineAgents = ordered.ToArray();
                        }
                    }
                    catch { /* keep full list */ }
                }

                // New agent messages → cards
                var messages = await _convex.CallQueryAsync("codeBranches:watchMessages",
                    new { branchId }, _token) as JsonArray;
                if (messages != null && messages.Count > renderedMessages)
                {
                    for (int i = renderedMessages; i < messages.Count; i++)
                    {
                        var agent = messages[i]?["agent"]?.GetValue<string>() ?? "Agent";
                        var content = messages[i]?["content"]?.GetValue<string>() ?? "";
                        if (agent != "User")
                            AppendAgentMessage(agent, content);
                    }
                    renderedMessages = messages.Count;
                    // A saved message supersedes whatever was streaming
                    if (liveBorder != null) { BuildPanel.Children.Remove(liveBorder); liveBorder = null; liveBlock = null; }
                    BuildScroll.ScrollToBottom();
                }

                // Live token stream from the agent currently generating
                var streamingContent = branch["streamingContent"]?.GetValue<string>();
                var streamingAgent = branch["streamingAgent"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(streamingContent))
                {
                    if (liveBlock == null)
                    {
                        AppendOutputStart(out liveBlock, out liveBorder, streamingAgent ?? currentAgent ?? "Agent");
                    }
                    liveBlock.Text = streamingContent;
                    BuildScroll.ScrollToBottom();
                }

                // Progress card
                var stageAgent = streamingAgent ?? currentAgent;
                AgentStageLabel.Text = status switch
                {
                    "paused" => "Waiting on sandbox commands…",
                    "completed" => "Finalizing…",
                    _ => stageAgent == "Dispatcher" ? "Dispatcher: routing your task…"
                       : stageAgent != null ? $"Agent: {stageAgent}"
                       : "Working…",
                };
                RenderAgentDots(pipelineAgents, stageAgent, allDone: status == "completed");

                if (status == "completed")
                {
                    if (liveBorder != null) { BuildPanel.Children.Remove(liveBorder); }
                    await FinishBuildAsync(branchId);
                    return;
                }

                await Task.Delay(PollMs, ct);
            }
        }

        private async Task FinishBuildAsync(string branchId)
        {
            // Show every code file the agents wrote
            var files = await _convex.CallQueryAsync("codeBranches:watchFiles",
                new { branchId }, _token) as JsonArray;

            int fileCount = files?.Count ?? 0;
            if (files != null && fileCount > 0)
            {
                AppendFilesHeader(fileCount);
                foreach (var f in files)
                {
                    var path = f?["filepath"]?.GetValue<string>() ?? "unknown";
                    var content = f?["content"]?.GetValue<string>() ?? "";
                    AppendFileCard(path, content);
                }
            }

            AgentProgressCard.Visibility = Visibility.Collapsed;
            AppendSuccessBanner(fileCount);
            SetIdle("Done", error: false);
            BuildScroll.ScrollToBottom();
        }

        private void SetIdle(string label, bool error)
        {
            _isBuilding = false;
            BuildButton.IsEnabled = true;
            BuildStatusLabel.Text = label;
            BuildStatusDot.Fill = (Brush)FindResource(error ? "RedBrush" : "GreenBrush");
        }

        private void RenderAgentDots(string[] agents, string? currentAgent, bool allDone)
        {
            AgentDots.Items.Clear();
            int activeIndex = currentAgent != null ? Array.IndexOf(agents, currentAgent) : -1;

            for (int i = 0; i < agents.Length; i++)
            {
                bool done = allDone || (activeIndex >= 0 && i < activeIndex);
                bool active = !allDone && i == activeIndex;

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
                    Text = agents[i],
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

        // A saved agent message — labeled card so the user can follow the hand-offs.
        private void AppendAgentMessage(string agent, string content)
        {
            var border = new Border
            {
                Background = (Brush)FindResource("BgCardBrush"),
                BorderBrush = (Brush)FindResource("BorderSubtleBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 0, 0, 12)
            };

            var stack = new StackPanel();
            stack.Children.Add(new TextBlock
            {
                Text = agent,
                FontSize = 10.5,
                FontWeight = FontWeights.Bold,
                FontFamily = (FontFamily)FindResource("MonoFontFamily"),
                Foreground = (Brush)FindResource("GreenBrush"),
                Margin = new Thickness(0, 0, 0, 6)
            });
            stack.Children.Add(new TextBlock
            {
                Text = content.Length > 4000 ? content[..4000] + "\n…" : content,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
                LineHeight = 18
            });
            border.Child = stack;
            BuildPanel.Children.Add(border);
        }

        // Live streaming output — monospace "build log" panel with agent label.
        private void AppendOutputStart(out TextBlock liveBlock, out Border liveBorder, string agent)
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

            var stack = new StackPanel();
            stack.Children.Add(new TextBlock
            {
                Text = $"{agent} — writing…",
                FontSize = 10.5,
                FontWeight = FontWeights.Bold,
                FontFamily = (FontFamily)FindResource("MonoFontFamily"),
                Foreground = (Brush)FindResource("AmberBrush"),
                Margin = new Thickness(0, 0, 0, 8)
            });
            var tb = new TextBlock
            {
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(Color.FromRgb(0x6e, 0xe7, 0xb7)),
                LineHeight = 19,
                FontFamily = (FontFamily)FindResource("MonoFontFamily")
            };
            stack.Children.Add(tb);
            liveBlock = tb;
            liveBorder = border;
            border.Child = stack;
            BuildPanel.Children.Add(border);
        }

        private void AppendFilesHeader(int count)
        {
            BuildPanel.Children.Add(new TextBlock
            {
                Text = $"FILES CREATED ({count})",
                FontSize = 10.5,
                FontWeight = FontWeights.Bold,
                FontFamily = (FontFamily)FindResource("MonoFontFamily"),
                Foreground = (Brush)FindResource("TextMutedBrush"),
                Margin = new Thickness(0, 4, 0, 8)
            });
        }

        // One expander per code file — header is the path, body is the content.
        private void AppendFileCard(string filepath, string content)
        {
            var contentBox = new TextBox
            {
                Text = content,
                IsReadOnly = true,
                BorderThickness = new Thickness(0),
                Background = Brushes.Transparent,
                Foreground = new SolidColorBrush(Color.FromRgb(0x6e, 0xe7, 0xb7)),
                FontFamily = (FontFamily)FindResource("MonoFontFamily"),
                FontSize = 11.5,
                TextWrapping = TextWrapping.Wrap,
                MaxHeight = 420,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Padding = new Thickness(0, 8, 0, 0)
            };

            var expander = new Expander
            {
                Header = new TextBlock
                {
                    Text = filepath,
                    FontSize = 11.5,
                    FontWeight = FontWeights.SemiBold,
                    FontFamily = (FontFamily)FindResource("MonoFontFamily"),
                    Foreground = (Brush)FindResource("TextPrimaryBrush")
                },
                Content = contentBox,
                IsExpanded = false,
                Foreground = (Brush)FindResource("TextMutedBrush")
            };

            BuildPanel.Children.Add(new Border
            {
                Background = (Brush)FindResource("BgInputBrush"),
                BorderBrush = (Brush)FindResource("BorderSubtleBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(14, 10, 14, 10),
                Margin = new Thickness(0, 0, 0, 8),
                Child = expander
            });
        }

        private void AppendSuccessBanner(int fileCount)
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
                Text = fileCount > 0
                    ? $"Build complete — {fileCount} file{(fileCount == 1 ? "" : "s")} written"
                    : "Build complete",
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
