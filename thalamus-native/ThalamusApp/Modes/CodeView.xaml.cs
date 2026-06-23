using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using ThalamusApp.Services;

namespace ThalamusApp.Modes
{
    public partial class CodeView : UserControl
    {
        private readonly ConvexClient _convex;
        private string? _token;
        private string? _activeProjectId;
        private string? _activeBranchId;
        private bool _pollingActive;

        public CodeView()
        {
            InitializeComponent();
            _convex = new ConvexClient();
            Loaded += OnLoaded;
        }

        public void SetToken(string token)
        {
            _token = token;
            LoadProjects();
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            if (_token != null) LoadProjects();
        }

        // ── Project list ──────────────────────────────────────────────────────

        private async void LoadProjects()
        {
            if (_token == null) return;
            try
            {
                var result = await _convex.CallQueryAsync("codeProjects:list", new { }, _token);
                ProjectList.Children.Clear();
                if (result is JsonArray arr)
                {
                    foreach (var item in arr)
                    {
                        if (item == null) continue;
                        var id   = item["_id"]?.GetValue<string>() ?? "";
                        var name = item["name"]?.GetValue<string>() ?? "Untitled";

                        var header = new TextBlock
                        {
                            Text       = name,
                            FontSize   = 11,
                            FontWeight = FontWeights.SemiBold,
                            Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)),
                            Margin     = new Thickness(14, 10, 0, 4),
                        };
                        ProjectList.Children.Add(header);

                        // Load branches for this project
                        await LoadBranches(id);
                    }
                }

                if (ProjectList.Children.Count == 0)
                {
                    ProjectList.Children.Add(new TextBlock
                    {
                        Text       = "No projects yet",
                        Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)),
                        FontSize   = 12,
                        Margin     = new Thickness(14, 8, 0, 0),
                    });
                }
            }
            catch { }
        }

        private async System.Threading.Tasks.Task LoadBranches(string projectId)
        {
            if (_token == null) return;
            try
            {
                var result = await _convex.CallQueryAsync(
                    "codeBranches:list", new { projectId }, _token);
                if (result is JsonArray arr)
                {
                    foreach (var item in arr)
                    {
                        if (item == null) continue;
                        var id   = item["_id"]?.GetValue<string>() ?? "";
                        var name = item["name"]?.GetValue<string>() ?? "main";
                        var btn  = new Button
                        {
                            Content = "  ⎇ " + name,
                            Tag     = (projectId, id, name),
                            Style   = (Style)FindResource("SideBtn"),
                        };
                        btn.Click += BranchBtn_Click;
                        ProjectList.Children.Add(btn);
                    }
                }
            }
            catch { }
        }

        private void BranchBtn_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn) return;
            if (btn.Tag is not ValueTuple<string, string, string> t) return;
            var (projId, branchId, branchName) = t;

            _activeProjectId = projId;
            _activeBranchId  = branchId;
            BranchLabel.Text = branchName;

            CodeEmptyState.Visibility = Visibility.Collapsed;
            RunAgentsBtn.IsEnabled    = true;
            CodeInputBox.IsEnabled    = true;
            CodeSendBtn.IsEnabled     = true;

            LoadMessages(branchId);
        }

        private void NewProject_Click(object sender, RoutedEventArgs e)
        {
            var name = ShowInputDialog("New Project", "Project name:", "My Project");
            if (!string.IsNullOrWhiteSpace(name))
                _ = CreateProject(name);
        }

        private static string? ShowInputDialog(string title, string prompt, string defaultValue)
        {
            var dlg    = new System.Windows.Window
            {
                Title = title, Width = 360, Height = 160,
                WindowStyle = WindowStyle.ToolWindow,
                ResizeMode  = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background  = new SolidColorBrush(Color.FromRgb(5, 10, 20)),
            };
            var panel  = new System.Windows.Controls.StackPanel { Margin = new Thickness(16) };
            var label  = new System.Windows.Controls.TextBlock
                { Text = prompt, Foreground = System.Windows.Media.Brushes.LightGray, Margin = new Thickness(0, 0, 0, 6) };
            var box    = new System.Windows.Controls.TextBox
                { Text = defaultValue, Padding = new Thickness(8, 6, 8, 6),
                  Background = new SolidColorBrush(Color.FromRgb(13, 31, 60)),
                  Foreground = System.Windows.Media.Brushes.White, BorderThickness = new Thickness(1),
                  BorderBrush = new SolidColorBrush(Color.FromRgb(30, 58, 95)) };
            var btnOk  = new System.Windows.Controls.Button
                { Content = "Create", Margin = new Thickness(0, 10, 0, 0), Padding = new Thickness(14, 6, 14, 6),
                  HorizontalAlignment = HorizontalAlignment.Right,
                  Background = new SolidColorBrush(Color.FromRgb(37, 99, 235)),
                  Foreground = System.Windows.Media.Brushes.White, BorderThickness = new Thickness(0) };

            string? result = null;
            btnOk.Click += (_, _) => { result = box.Text; dlg.Close(); };
            box.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Return) { result = box.Text; dlg.Close(); } };

            panel.Children.Add(label);
            panel.Children.Add(box);
            panel.Children.Add(btnOk);
            dlg.Content = panel;
            dlg.ShowDialog();
            return result;
        }

        private async System.Threading.Tasks.Task CreateProject(string name)
        {
            if (_token == null) return;
            try
            {
                await _convex.CallMutationAsync(
                    "codeProjects:create", new { name }, _token);
                LoadProjects();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to create project: {ex.Message}", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        // ── Agent messages ────────────────────────────────────────────────────

        private async void LoadMessages(string branchId)
        {
            if (_token == null) return;
            AgentMessageList.Children.Clear();
            try
            {
                var result = await _convex.CallQueryAsync(
                    "codeBranches:getMessages", new { branchId }, _token);
                if (result is JsonArray msgs)
                {
                    foreach (var msg in msgs)
                    {
                        if (msg == null) continue;
                        AddAgentMessage(msg);
                    }
                }
            }
            catch { }
            ScrollAgentFeed();
            StartPolling(branchId);
        }

        private void AddAgentMessage(JsonNode msg)
        {
            var agent   = msg["agent"]?.GetValue<string>() ?? "system";
            var content = msg["content"]?.GetValue<string>() ?? "";
            var status  = msg["status"]?.GetValue<string>() ?? "";

            var row = new Border
            {
                Margin          = new Thickness(0, 3, 0, 3),
                Padding         = new Thickness(12, 8, 12, 8),
                CornerRadius    = new CornerRadius(8),
                Background      = new SolidColorBrush(Color.FromRgb(10, 22, 40)),
                BorderBrush     = new SolidColorBrush(Color.FromRgb(30, 58, 95)),
                BorderThickness = new Thickness(1),
            };

            var panel = new StackPanel();

            // Agent label row
            var labelRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            labelRow.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding      = new Thickness(6, 1, 6, 1),
                Margin       = new Thickness(0, 0, 6, 0),
                Background   = AgentColor(agent),
                Child        = new TextBlock
                {
                    Text       = agent.ToUpperInvariant(),
                    FontSize   = 9,
                    FontWeight = FontWeights.Bold,
                    Foreground = Brushes.White,
                },
            });
            if (!string.IsNullOrEmpty(status))
            {
                labelRow.Children.Add(new TextBlock
                {
                    Text       = status,
                    FontSize   = 10,
                    Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)),
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }
            panel.Children.Add(labelRow);

            // Content
            panel.Children.Add(new TextBlock
            {
                Text         = content,
                FontSize     = 12,
                Foreground   = new SolidColorBrush(Color.FromRgb(203, 213, 225)),
                TextWrapping = TextWrapping.Wrap,
            });

            row.Child = panel;
            AgentMessageList.Children.Add(row);
        }

        private static SolidColorBrush AgentColor(string agent) => agent.ToLower() switch
        {
            "researcher" => new SolidColorBrush(Color.FromRgb(6, 95, 70)),
            "analyser"   => new SolidColorBrush(Color.FromRgb(30, 58, 138)),
            "planner"    => new SolidColorBrush(Color.FromRgb(67, 20, 95)),
            "coder"      => new SolidColorBrush(Color.FromRgb(37, 99, 235)),
            "optimiser"  => new SolidColorBrush(Color.FromRgb(79, 70, 229)),
            "organizer"  => new SolidColorBrush(Color.FromRgb(5, 150, 105)),
            "tester"     => new SolidColorBrush(Color.FromRgb(202, 138, 4)),
            "hacker"     => new SolidColorBrush(Color.FromRgb(185, 28, 28)),
            "critic"     => new SolidColorBrush(Color.FromRgb(124, 58, 237)),
            _            => new SolidColorBrush(Color.FromRgb(51, 65, 85)),
        };

        // ── Polling ───────────────────────────────────────────────────────────

        private async void StartPolling(string branchId)
        {
            _pollingActive = true;
            while (_pollingActive && _activeBranchId == branchId && _token != null)
            {
                await System.Threading.Tasks.Task.Delay(3000);
                if (!_pollingActive || _activeBranchId != branchId) break;
                try
                {
                    var result = await _convex.CallQueryAsync(
                        "codeBranches:getMessages", new { branchId }, _token);
                    if (result is JsonArray msgs)
                    {
                        int currentCount = AgentMessageList.Children.Count;
                        int newCount     = msgs.Count;
                        if (newCount > currentCount)
                        {
                            for (int i = currentCount; i < newCount; i++)
                            {
                                if (msgs[i] != null)
                                    Dispatcher.Invoke(() => AddAgentMessage(msgs[i]!));
                            }
                            Dispatcher.Invoke(ScrollAgentFeed);
                            UpdateStatusBadge(msgs[newCount - 1]);
                        }
                    }
                }
                catch { }
            }
        }

        private void UpdateStatusBadge(JsonNode? lastMsg)
        {
            if (lastMsg == null) return;
            var pipelineStatus = lastMsg["pipelineStatus"]?.GetValue<string>();
            if (string.IsNullOrEmpty(pipelineStatus)) return;

            Dispatcher.Invoke(() =>
            {
                StatusBadge.Visibility = Visibility.Visible;
                StatusText.Text = pipelineStatus.ToUpperInvariant();
            });
        }

        // ── Input + send ──────────────────────────────────────────────────────

        private void CodeInput_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return) { e.Handled = true; _ = SendCodePromptAsync(); }
        }

        private void CodeSend_Click(object sender, RoutedEventArgs e) => _ = SendCodePromptAsync();

        private void RunAgents_Click(object sender, RoutedEventArgs e) => _ = SendCodePromptAsync();

        private async System.Threading.Tasks.Task SendCodePromptAsync()
        {
            var prompt = CodeInputBox.Text.Trim();
            if (string.IsNullOrEmpty(prompt) || _activeBranchId == null || _token == null) return;

            CodeInputBox.Clear();
            CodeSendBtn.IsEnabled = false;
            CodeInputBox.IsEnabled = false;

            try
            {
                await _convex.CallActionAsync(
                    "codePipeline:startRun",
                    new { branchId = _activeBranchId, prompt },
                    _token);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to start agents: {ex.Message}", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                CodeSendBtn.IsEnabled  = true;
                CodeInputBox.IsEnabled = true;
            }
        }

        private void ScrollAgentFeed()
        {
            AgentScroll.UpdateLayout();
            AgentScroll.ScrollToBottom();
        }

        // Clean up polling when hidden
        protected void OnUnloaded() => _pollingActive = false;
    }
}
