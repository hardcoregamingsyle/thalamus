using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using ThalamusApp.Controls;
using ThalamusApp.Services;

namespace ThalamusApp.Modes
{
    public partial class ResearchView : UserControl
    {
        private readonly ConvexClient _convex;
        private readonly StreamingClient _stream;
        private string? _token;
        private string? _activeConvId;
        private readonly List<(string role, string text)> _history = new();
        private MessageBubble? _streamingBubble;
        private CancellationTokenSource? _cts;
        private bool _isStreaming;

        private const string MODE = "research";
        private const string SYSTEM_PROMPT =
            "You are Thalamus AI in Research mode. Provide thorough, well-structured, " +
            "deeply researched answers with citations, analysis, and multiple perspectives. " +
            "Use headers, bullet points, and structured output where appropriate.";

        public ResearchView()
        {
            InitializeComponent();
            _convex = new ConvexClient();
            _stream = new StreamingClient(_convex);
        }

        public void SetToken(string token)
        {
            _token = token;
            LoadConversations();
        }

        private async void LoadConversations()
        {
            if (_token == null) return;
            try
            {
                var result = await _convex.CallQueryAsync("ai:getConversations", new { mode = MODE }, _token);
                ConvList.Children.Clear();
                if (result is JsonArray arr)
                {
                    foreach (var item in arr)
                    {
                        if (item == null) continue;
                        var id    = item["_id"]?.GetValue<string>() ?? "";
                        var title = item["title"]?.GetValue<string>() ?? "Untitled Research";
                        var btn   = new Button { Content = title, Tag = id, Style = (Style)FindResource("ConvBtn") };
                        btn.Click += ConvBtn_Click;
                        ConvList.Children.Add(btn);
                    }
                }
            }
            catch { }
        }

        private void ConvBtn_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn) return;
            _activeConvId = btn.Tag as string;
            LoadMessages(_activeConvId!);
        }

        private async void LoadMessages(string convId)
        {
            if (_token == null) return;
            MessageList.Children.Clear();
            _history.Clear();
            EmptyState.Visibility = Visibility.Collapsed;
            try
            {
                var result = await _convex.CallQueryAsync("ai:getMessages", new { conversationId = convId }, _token);
                if (result is JsonArray msgs)
                {
                    foreach (var msg in msgs)
                    {
                        if (msg == null) continue;
                        var role = msg["role"]?.GetValue<string>() ?? "user";
                        var text = msg["content"]?.GetValue<string>() ?? "";
                        AddBubble(role, text);
                        _history.Add((role, text));
                    }
                }
            }
            catch { }
            ScrollToBottom();
        }

        private void NewConv_Click(object sender, RoutedEventArgs e)
        {
            _activeConvId = null;
            MessageList.Children.Clear();
            _history.Clear();
            EmptyState.Visibility = Visibility.Visible;
            InputBox.Focus();
        }

        private void Input_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return && !_isStreaming) { e.Handled = true; _ = SendAsync(); }
        }

        private void Send_Click(object sender, RoutedEventArgs e)
        {
            if (!_isStreaming) _ = SendAsync();
        }

        private async System.Threading.Tasks.Task SendAsync()
        {
            var content = InputBox.Text.Trim();
            if (string.IsNullOrEmpty(content) || _token == null) return;

            InputBox.Clear();
            EmptyState.Visibility = Visibility.Collapsed;
            AddBubble("user", content);
            _history.Add(("user", content));
            ScrollToBottom();

            _streamingBubble = AddBubble("assistant", "");
            ScrollToBottom();

            SetStreaming(true);
            _cts = new CancellationTokenSource();
            var fullResponse = "";

            try
            {
                fullResponse = await _stream.StreamChatAsync(
                    content, MODE, _history, SYSTEM_PROMPT, _token, _activeConvId,
                    (type, chunk) => Dispatcher.Invoke(() =>
                    {
                        if (type is "thinking" or "answer")
                            _streamingBubble?.AppendText(chunk);
                        ScrollToBottom();
                    }),
                    _cts.Token);

                _history.Add(("assistant", fullResponse));
                LoadConversations();
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { _streamingBubble?.SetMessage("assistant", $"Error: {ex.Message}"); }
            finally
            {
                _streamingBubble = null;
                SetStreaming(false);
            }
        }

        private MessageBubble AddBubble(string role, string text)
        {
            var b = new MessageBubble();
            b.SetMessage(role, text);
            MessageList.Children.Add(b);
            return b;
        }

        private void SetStreaming(bool on)
        {
            _isStreaming        = on;
            SendBtn.IsEnabled   = !on;
            InputBox.IsEnabled  = !on;
        }

        private void ScrollToBottom()
        {
            ChatScroll.UpdateLayout();
            ChatScroll.ScrollToBottom();
        }
    }
}
