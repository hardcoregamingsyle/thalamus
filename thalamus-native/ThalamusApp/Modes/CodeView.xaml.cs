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

        // The pipeline writes status "idle" between EVERY step while it
        // self-reschedules, so "not running" is not a terminal signal on its own.
        // What IS terminal is a branch that stopped moving: updateBranchStatus
        // bumps lastActivityAt on every write, so if that timestamp is frozen
        // while the branch is not running, nothing is going to resume it —
        // a user Stop, an error abort, or a pause waiting on an API key the
        // desktop has no UI to answer. 60 polls ≈ 90s of silence before we call it.
        private const int StallPolls = 60;

        // Same idea after the user presses Stop, but the pipeline only has to
        // reach its next step and park, so ~9s of silence is enough.
        private const int StopStallPolls = 6;

        // Set the moment Stop is pressed so the poll loop reports "stopped"
        // instead of blaming the pipeline for going quiet.
        private bool _stopRequested;
        private string? _activeBranchId;

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
            _stopRequested = false;
            _activeBranchId = null;
            BuildButton.IsEnabled = false;
            StopBuildButton.IsEnabled = true;
            BuildStatusLabel.Text = "Building…";
            BuildStatusDot.SetResourceReference(Shape.FillProperty, "AmberBrush");

            _cts = new CancellationTokenSource(BuildTimeout);

            try
            {
                // 1. Project + main branch (server auto-creates "main")
                var projectName = prompt.Length > 48 ? prompt[..48] : prompt;
                var created = await _convex.CallMutationAsync("codeProjects:createProject",
                    new { token = _token, name = projectName, description = prompt }, _token);
                var branchId = created?["branchId"]?.GetValue<string>()
                    ?? throw new Exception("Project creation returned no branch");
                _activeBranchId = branchId;

                // 2. Kick off the real pipeline
                // "local" tells the backend not to hand this branch's commands to a
                // cloud sandbox — we run them here, on this machine, and report back.
                await _convex.CallActionAsync("codePipeline:startPipeline",
                    new { token = _token, branchId, userPrompt = prompt, executor = "local" }, _token);

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
            double lastActivityAt = 0;
            int stalledPolls = 0;

            while (true)
            {
                ct.ThrowIfCancellationRequested();

                var branch = await _convex.CallQueryAsync("codeBranches:getBranch",
                    new { token = _token!, branchId }, _token);
                if (branch == null) throw new Exception("Branch disappeared");

                var status = branch["status"]?.GetValue<string>() ?? "idle";
                var currentAgent = branch["currentAgent"]?.GetValue<string>();

                // Stall detection — see StallPolls. Only counts while the branch
                // is NOT running, so a single agent thinking for two minutes
                // (status "running", timestamp frozen) is never mistaken for dead.
                var activityAt = branch["lastActivityAt"]?.GetValue<double>() ?? 0;
                if (status == "running" || activityAt > lastActivityAt) stalledPolls = 0;
                else stalledPolls++;
                lastActivityAt = activityAt;

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
                AgentStageLabel.Text = _stopRequested ? "Stopping…" : status switch
                {
                    "paused" => "Paused — waiting on a sandbox command or an API key…",
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

                // Commands the agents queued run right here, in this branch's own
                // workspace, and reporting a result resumes the pipeline server-side.
                // Doing it before the stall check matters: a build that installs
                // dependencies is legitimately quiet for minutes, and counting that
                // as death would kill every real project.
                if (status == "paused" && !_stopRequested)
                {
                    if (await RunPendingCommandsAsync(branchId, ct)) { stalledPolls = 0; }
                }

                // Parked for good — say so now instead of polling for 20 minutes
                // and then calling it a timeout. After an explicit Stop we only
                // need long enough for the pipeline to notice the flag and write
                // its final "idle", so don't make the user sit through 90s.
                if (stalledPolls >= (_stopRequested ? StopStallPolls : StallPolls))
                {
                    if (liveBorder != null) { BuildPanel.Children.Remove(liveBorder); }
                    AgentProgressCard.Visibility = Visibility.Collapsed;
                    if (_stopRequested)
                    {
                        AppendBuildError("Build stopped. The files written so far are saved on your project.");
                        SetIdle("Stopped", error: false);
                    }
                    else if (status == "paused")
                    {
                        AppendBuildError("The pipeline is paused waiting for input — usually an API key. "
                            + "Desktop can't answer that yet: open this project at /portal/code on the website to continue.");
                        SetIdle("Paused", error: true);
                    }
                    else
                    {
                        AppendBuildError("The pipeline stopped early. Check this project on the website for the agent's last message.");
                        SetIdle("Stopped", error: true);
                    }
                    return;
                }

                await Task.Delay(PollMs, ct);
            }
        }

        /// <summary>
        /// Runs everything the branch is waiting on, locally. Returns true if it
        /// ran at least one command, which the caller treats as activity.
        /// </summary>
        private async Task<bool> RunPendingCommandsAsync(string branchId, CancellationToken ct)
        {
            var pending = await _convex.CallQueryAsync("codeCommands:listPendingForBranch",
                new { token = _token!, branchId }, _token) as JsonArray;
            if (pending == null || pending.Count == 0) return false;

            // Seed the workspace from the branch's files so `npm test` and friends
            // run against the real code instead of an empty directory.
            var files = await _convex.CallQueryAsync("codeBranches:watchFiles",
                new { branchId }, _token) as JsonArray;
            if (files != null)
            {
                var pairs = new List<(string, string)>();
                foreach (var f in files)
                {
                    var fp = f?["filepath"]?.GetValue<string>();
                    var content = f?["content"]?.GetValue<string>();
                    if (fp != null && content != null) pairs.Add((fp, content));
                }
                await Task.Run(() => LocalCommandRunner.SyncFiles(branchId, pairs), ct);
            }

            foreach (var item in pending)
            {
                ct.ThrowIfCancellationRequested();
                var commandId = item?["id"]?.GetValue<string>();
                var command = item?["command"]?.GetValue<string>();
                if (commandId == null || command == null) continue;

                AppendLocalCommand(command);
                var (output, exitCode) = await LocalCommandRunner.RunAsync(branchId, command, ct);
                AppendLocalCommandResult(output, exitCode);

                // completeCommand resumes the pipeline once nothing is pending, so
                // a throw here would strand the branch — report the failure instead.
                try
                {
                    await _convex.CallMutationAsync("codeCommands:completeCommand",
                        new { token = _token!, commandId, output, exitCode }, _token);
                }
                catch (Exception ex)
                {
                    try
                    {
                        await _convex.CallMutationAsync("codeCommands:failCommand",
                            new { token = _token!, commandId, output = $"Local runner could not report a result: {ex.Message}" }, _token);
                    }
                    catch { /* the stall check will surface it */ }
                }
            }
            return true;
        }

        // Stop the running pipeline. codePipeline:stopPipeline only sets a flag —
        // the pipeline halts at its next step — so the poll loop keeps running
        // until the branch actually goes quiet, and the stall check ends it.
        private async void StopBuild_Click(object sender, RoutedEventArgs e)
        {
            if (!_isBuilding || string.IsNullOrEmpty(_token) || _activeBranchId == null) return;

            StopBuildButton.IsEnabled = false;
            _stopRequested = true;
            AgentStageLabel.Text = "Stopping…";
            try
            {
                await _convex.CallActionAsync("codePipeline:stopPipeline",
                    new { token = _token!, branchId = _activeBranchId }, _token);
            }
            catch (Exception ex)
            {
                AppendBuildError($"Could not stop the build: {ex.Message}");
                StopBuildButton.IsEnabled = true;
                _stopRequested = false;
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
            BuildStatusDot.SetResourceReference(Shape.FillProperty, error ? "RedBrush" : "GreenBrush");
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
                    dot.Fill = (Brush)FindResource("TintBlueBorderBrush");

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

        // What we are about to run on this machine. Shown before it runs, not
        // after, so the user is never surprised by something already executing.
        private void AppendLocalCommand(string command)
        {
            BuildPanel.Children.Add(new Border
            {
                Background = (Brush)FindResource("BgCardBrush"),
                BorderBrush = (Brush)FindResource("BorderSubtleBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(0, 0, 0, 6),
                Child = new TextBlock
                {
                    Text = "> " + command,
                    FontFamily = new FontFamily("Consolas, Cascadia Mono, monospace"),
                    FontSize = 11.5,
                    Foreground = (Brush)FindResource("TextPrimaryBrush"),
                    TextWrapping = TextWrapping.Wrap
                }
            });
            BuildScroll.ScrollToBottom();
        }

        private void AppendLocalCommandResult(string output, int exitCode)
        {
            var shown = output.Length > 4000 ? output[..4000] + Environment.NewLine + "… (truncated for display)" : output;
            if (string.IsNullOrWhiteSpace(shown)) shown = exitCode == 0 ? "(no output)" : $"(no output, exit {exitCode})";

            BuildPanel.Children.Add(new Border
            {
                Background = (Brush)FindResource("ConsoleBgBrush"),
                BorderBrush = (Brush)FindResource(exitCode == 0 ? "BorderSubtleBrush" : "TintRedBorderBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(12, 8, 12, 8),
                Margin = new Thickness(0, 0, 0, 12),
                Child = new TextBlock
                {
                    Text = shown,
                    FontFamily = new FontFamily("Consolas, Cascadia Mono, monospace"),
                    FontSize = 11,
                    Foreground = (Brush)FindResource("ConsoleTextBrush"),
                    TextWrapping = TextWrapping.Wrap
                }
            });
            BuildScroll.ScrollToBottom();
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
                Foreground = (Brush)FindResource("ConsoleTextBrush"),
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
                Foreground = (Brush)FindResource("ConsoleTextBrush"),
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
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 12, 0, 16)
            };
            border.SetResourceReference(Border.BackgroundProperty, "TintGreenBgBrush");
            border.SetResourceReference(Border.BorderBrushProperty, "TintGreenStrongBorderBrush");
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            var dot = new Ellipse
            {
                Width = 8, Height = 8,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 10, 0)
            };
            dot.SetResourceReference(Shape.FillProperty, "GreenBrush");
            sp.Children.Add(dot);
            var label = new TextBlock
            {
                Text = fileCount > 0
                    ? $"Build complete — {fileCount} file{(fileCount == 1 ? "" : "s")} written"
                    : "Build complete",
                FontSize = 12.5, FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center
            };
            label.SetResourceReference(TextBlock.ForegroundProperty, "GreenBrush");
            sp.Children.Add(label);
            border.Child = sp;
            BuildPanel.Children.Add(border);
        }

        private void AppendBuildError(string msg)
        {
            var text = new TextBlock
            {
                Text = msg, FontSize = 12.5, TextWrapping = TextWrapping.Wrap
            };
            text.SetResourceReference(TextBlock.ForegroundProperty, "RedBrush");
            var border = new Border
            {
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(16, 12, 16, 12),
                Margin = new Thickness(0, 0, 0, 12),
                Child = text
            };
            border.SetResourceReference(Border.BackgroundProperty, "TintRedBgBrush");
            border.SetResourceReference(Border.BorderBrushProperty, "TintRedBorderBrush");
            BuildPanel.Children.Add(border);
            BuildScroll.ScrollToBottom();
        }
    }
}
