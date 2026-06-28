using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using ThalamusApp.Services;

namespace ThalamusApp.Modes
{
    public partial class StudyView : UserControl
    {
        private readonly ConvexClient _convex;
        private string? _token;
        private string? _activeDeckId;
        private readonly List<(string question, string answer)> _cards = new();
        private int _cardIndex;
        private bool _showingAnswer;

        public StudyView()
        {
            InitializeComponent();
            _convex = new ConvexClient();
        }

        public void SetToken(string token)
        {
            _token = token;
            LoadDecks();
        }

        // ── Deck list ─────────────────────────────────────────────────────────

        private async void LoadDecks()
        {
            if (_token == null) return;
            try
            {
                var result = await _convex.CallQueryAsync("rag:getStudyDecks", new { }, _token);
                DeckList.Children.Clear();
                if (result is JsonArray arr)
                {
                    foreach (var item in arr)
                    {
                        if (item == null) continue;
                        var id   = item["_id"]?.GetValue<string>() ?? "";
                        var name = item["name"]?.GetValue<string>() ?? "Untitled Deck";
                        var count = item["cardCount"]?.GetValue<int>() ?? 0;

                        var btn = new Button
                        {
                            Content = $"{name} ({count})",
                            Tag     = (id, name),
                            Style   = (Style)FindResource("DeckBtn"),
                        };
                        btn.Click += DeckBtn_Click;
                        DeckList.Children.Add(btn);
                    }
                }

                if (DeckList.Children.Count == 0)
                {
                    DeckList.Children.Add(new TextBlock
                    {
                        Text       = "No decks yet",
                        Foreground = System.Windows.Media.Brushes.Gray,
                        FontSize   = 12,
                        Margin     = new Thickness(14, 8, 0, 0),
                    });
                }
            }
            catch { }
        }

        private async void DeckBtn_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn) return;
            if (btn.Tag is not ValueTuple<string, string> t) return;
            var (id, name) = t;

            _activeDeckId = id;
            DeckTitle.Text = name;

            await LoadCards(id);
        }

        private async System.Threading.Tasks.Task LoadCards(string deckId)
        {
            _cards.Clear();
            _cardIndex = 0;

            try
            {
                var result = await _convex.CallQueryAsync("rag:getDeckCards", new { deckId }, _token);
                if (result is JsonArray arr)
                {
                    foreach (var c in arr)
                    {
                        if (c == null) continue;
                        var q = c["front"]?.GetValue<string>() ?? c["question"]?.GetValue<string>() ?? "";
                        var a = c["back"]?.GetValue<string>()  ?? c["answer"]?.GetValue<string>()   ?? "";
                        _cards.Add((q, a));
                    }
                }
            }
            catch { }

            if (_cards.Count == 0)
            {
                _cards.Add(("No cards in this deck yet.", "Generate a quiz or add cards via the web portal."));
            }

            ShowCard(0);
            EmptyState.Visibility = Visibility.Collapsed;
            CardPanel.Visibility  = Visibility.Visible;
            QuizArea.Visibility   = Visibility.Collapsed;
        }

        // ── Card display ──────────────────────────────────────────────────────

        private void ShowCard(int index)
        {
            if (_cards.Count == 0) return;
            _cardIndex    = Math.Clamp(index, 0, _cards.Count - 1);
            _showingAnswer = false;

            QuestionText.Text = _cards[_cardIndex].question;
            AnswerText.Text   = _cards[_cardIndex].answer;

            CardFront.Visibility = Visibility.Visible;
            CardBack.Visibility  = Visibility.Collapsed;
            FlipHint.Visibility  = Visibility.Visible;

            CardCounter.Text = $"Card {_cardIndex + 1} / {_cards.Count}";
            PrevBtn.IsEnabled = _cardIndex > 0;
            NextBtn.IsEnabled = _cardIndex < _cards.Count - 1;
        }

        private void Card_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            _showingAnswer = !_showingAnswer;
            CardFront.Visibility = _showingAnswer ? Visibility.Collapsed : Visibility.Visible;
            CardBack.Visibility  = _showingAnswer ? Visibility.Visible   : Visibility.Collapsed;
            FlipHint.Visibility  = _showingAnswer ? Visibility.Collapsed : Visibility.Visible;
        }

        private void Prev_Click(object sender, RoutedEventArgs e) => ShowCard(_cardIndex - 1);
        private void Next_Click(object sender, RoutedEventArgs e) => ShowCard(_cardIndex + 1);

        // ── Quiz generation ───────────────────────────────────────────────────

        private async void GenerateQuiz_Click(object sender, RoutedEventArgs e)
        {
            if (_activeDeckId == null || _token == null) return;

            QuizBtn.IsEnabled  = false;
            QuizArea.Visibility = Visibility.Visible;
            QuizText.Text      = "Generating quiz...";

            try
            {
                var result = await _convex.CallActionAsync(
                    "ai:generateStudyQuiz", new { deckId = _activeDeckId }, _token);

                var quiz = result?["quiz"]?.GetValue<string>()
                        ?? result?.ToString()
                        ?? "No quiz generated.";

                QuizText.Text = quiz;
            }
            catch (Exception ex)
            {
                QuizText.Text = $"Error: {ex.Message}";
            }
            finally
            {
                QuizBtn.IsEnabled = true;
            }
        }
    }
}
