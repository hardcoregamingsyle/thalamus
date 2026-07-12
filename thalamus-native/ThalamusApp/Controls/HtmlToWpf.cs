using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace ThalamusApp.Controls
{
    /// <summary>
    /// Renders the semantic HTML the AI returns (the backend forces "clean HTML,
    /// no markdown") into native WPF elements inside a Panel — the desktop twin of
    /// the website's dangerouslySetInnerHTML. Deliberately dependency-free: no
    /// WebView2, no NuGet, so it stays compatible with the self-contained
    /// single-file publish. Handles the bounded tag set the model emits
    /// (h1-h4, p, ul/ol/li, strong/b, em/i, code, pre, blockquote, hr, br, a,
    /// table) and degrades any unknown markup to readable text. Never throws.
    /// </summary>
    public static class HtmlToWpf
    {
        private static readonly HashSet<string> BlockTags = new()
        { "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "blockquote", "pre", "hr", "table" };

        public static void Populate(Panel target, string? html)
        {
            target.Children.Clear();
            if (string.IsNullOrWhiteSpace(html)) return;
            try
            {
                ParseBlocks(target, Preprocess(html!));
                if (target.Children.Count == 0)
                    target.Children.Add(Para(html!)); // nothing matched — show it plainly
            }
            catch
            {
                target.Children.Clear();
                target.Children.Add(NewFlow(PlainText(html!)));
            }
        }

        /// <summary>Tags stripped + entities decoded — used for the live streaming preview.</summary>
        public static string PlainText(string html)
        {
            var noTags = Regex.Replace(html ?? "", "<[^>]+>", "");
            return WebUtility.HtmlDecode(noTags).Trim();
        }

        // ── Preprocess ───────────────────────────────────────────────────────
        private static string Preprocess(string html)
        {
            html = html.Trim();
            // Some models wrap the whole answer in a ```html … ``` fence despite
            // being told not to — peel it off so we render the HTML, not the fence.
            if (html.StartsWith("```"))
            {
                int nl = html.IndexOf('\n');
                if (nl >= 0) html = html[(nl + 1)..];
                if (html.EndsWith("```")) html = html[..^3];
                html = html.Trim();
            }
            html = Regex.Replace(html, "<!--.*?-->", "", RegexOptions.Singleline);
            html = Regex.Replace(html, "<script.*?</script>", "", RegexOptions.Singleline | RegexOptions.IgnoreCase);
            html = Regex.Replace(html, "<style.*?</style>", "", RegexOptions.Singleline | RegexOptions.IgnoreCase);
            return html;
        }

        // ── Block parser (cursor-based so nested ul/blockquote/pre survive) ───
        private static void ParseBlocks(Panel target, string html)
        {
            int i = 0;
            var pending = new System.Text.StringBuilder();

            void FlushPara()
            {
                var s = pending.ToString().Trim();
                pending.Clear();
                if (s.Length > 0) target.Children.Add(Para(s));
            }

            while (i < html.Length)
            {
                int lt = html.IndexOf('<', i);
                if (lt < 0) { pending.Append(html[i..]); break; }
                if (lt > i) { pending.Append(html[i..lt]); i = lt; continue; }

                if (!TryReadTag(html, lt, out int te, out bool isClose, out bool self, out string name, out string attrs))
                { pending.Append('<'); i = lt + 1; continue; }

                if (BlockTags.Contains(name) && !isClose)
                {
                    FlushPara();
                    if (name == "hr" || self) { target.Children.Add(Hr()); i = te; continue; }
                    int closeLt = FindMatchingClose(html, name, te, out int after);
                    string inner = closeLt >= 0 ? html[te..closeLt] : html[te..];
                    RenderBlock(target, name, inner);
                    i = closeLt >= 0 ? after : html.Length;
                }
                else if (name == "br" && !isClose) { pending.Append('\n'); i = te; }
                else { pending.Append(html[lt..te]); i = te; } // inline tag → part of a paragraph
            }
            FlushPara();
        }

        private static void RenderBlock(Panel target, string tag, string inner)
        {
            switch (tag)
            {
                case "h1": target.Children.Add(Heading(1, inner)); break;
                case "h2": target.Children.Add(Heading(2, inner)); break;
                case "h3": target.Children.Add(Heading(3, inner)); break;
                case "h4":
                case "h5":
                case "h6": target.Children.Add(Heading(4, inner)); break;
                case "p": target.Children.Add(Para(inner)); break;
                case "ul": MakeList(target, inner, false); break;
                case "ol": MakeList(target, inner, true); break;
                case "pre": target.Children.Add(CodeBlock(inner)); break;
                case "blockquote": target.Children.Add(BlockQuote(inner)); break;
                case "table": MakeTable(target, inner); break;
            }
        }

        // ── Block builders ───────────────────────────────────────────────────
        private static TextBlock Para(string inner)
        {
            var tb = NewFlow(null);
            tb.Margin = new Thickness(0, 0, 0, 10);
            AppendInlines(tb, inner);
            return tb;
        }

        private static TextBlock Heading(int level, string inner)
        {
            var tb = NewFlow(null);
            tb.FontWeight = FontWeights.Bold;
            tb.FontSize = level <= 1 ? 20 : level == 2 ? 17 : level == 3 ? 15 : 13.5;
            tb.Margin = new Thickness(0, level <= 2 ? 8 : 4, 0, 6);
            AppendInlines(tb, inner);
            return tb;
        }

        private static Border BlockQuote(string inner)
        {
            var sp = new StackPanel();
            ParseBlocks(sp, inner);
            return new Border
            {
                BorderBrush = Br("BorderBrush", "#3a3a3a"),
                BorderThickness = new Thickness(3, 0, 0, 0),
                Padding = new Thickness(12, 2, 0, 2),
                Margin = new Thickness(0, 2, 0, 10),
                Child = sp,
            };
        }

        private static Border CodeBlock(string inner)
        {
            // <pre> usually wraps a single <code>…</code>; unwrap it, keep the text verbatim.
            var m = Regex.Match(inner, "<code[^>]*>(.*?)</code>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
            string code = WebUtility.HtmlDecode((m.Success ? m.Groups[1].Value : Regex.Replace(inner, "<[^>]+>", "")).Trim('\r', '\n'));
            return new Border
            {
                Background = Br("BgInputBrush", "#1c1c1c"),
                BorderBrush = Br("BorderSubtleBrush", "#1AFFFFFF"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(12, 10, 12, 10),
                Margin = new Thickness(0, 2, 0, 12),
                Child = new TextBlock
                {
                    Text = code,
                    FontFamily = Mono(),
                    FontSize = 12.5,
                    Foreground = Br("TextSecondaryBrush", "#c4c4c4"),
                    TextWrapping = TextWrapping.Wrap,
                },
            };
        }

        private static void MakeList(Panel target, string inner, bool ordered)
        {
            var list = new StackPanel { Margin = new Thickness(0, 2, 0, 10) };
            int i = 0, n = 1;
            while (i < inner.Length)
            {
                int lt = inner.IndexOf('<', i);
                if (lt < 0) break;
                if (TryReadTag(inner, lt, out int te, out bool isClose, out _, out string name, out _) && name == "li" && !isClose)
                {
                    int closeLt = FindMatchingClose(inner, "li", te, out int after);
                    string item = closeLt >= 0 ? inner[te..closeLt] : inner[te..];
                    list.Children.Add(ListItem(item, ordered, n++));
                    i = closeLt >= 0 ? after : inner.Length;
                }
                else { i = TryReadTag(inner, lt, out int te2, out _, out _, out _, out _) ? te2 : lt + 1; }
            }
            if (list.Children.Count > 0) target.Children.Add(list);
        }

        private static Grid ListItem(string item, bool ordered, int n)
        {
            var g = new Grid { Margin = new Thickness(0, 0, 0, 4) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ordered ? 26 : 18) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var bullet = new TextBlock
            {
                Text = ordered ? $"{n}." : "•",
                FontSize = 13.5,
                LineHeight = 21,
                Foreground = Br("BlueBrush", "#0088f1"),
                VerticalAlignment = VerticalAlignment.Top,
            };
            Grid.SetColumn(bullet, 0);
            g.Children.Add(bullet);

            if (ContainsBlock(item))
            {
                var sp = new StackPanel();
                ParseBlocks(sp, item);
                Grid.SetColumn(sp, 1);
                g.Children.Add(sp);
            }
            else
            {
                var tb = NewFlow(null);
                AppendInlines(tb, item);
                Grid.SetColumn(tb, 1);
                g.Children.Add(tb);
            }
            return g;
        }

        private static void MakeTable(Panel target, string inner)
        {
            var rows = new List<List<(string html, bool header)>>();
            foreach (Match r in Regex.Matches(inner, "<tr[^>]*>(.*?)</tr>", RegexOptions.Singleline | RegexOptions.IgnoreCase))
            {
                var cells = new List<(string, bool)>();
                foreach (Match c in Regex.Matches(r.Groups[1].Value, "<(td|th)[^>]*>(.*?)</\\1>", RegexOptions.Singleline | RegexOptions.IgnoreCase))
                    cells.Add((c.Groups[2].Value, c.Groups[1].Value.Equals("th", StringComparison.OrdinalIgnoreCase)));
                if (cells.Count > 0) rows.Add(cells);
            }
            if (rows.Count == 0) return;

            int cols = 0;
            foreach (var r in rows) cols = Math.Max(cols, r.Count);
            var grid = new Grid { Margin = new Thickness(0, 2, 0, 12) };
            for (int c = 0; c < cols; c++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (int r = 0; r < rows.Count; r++) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            for (int r = 0; r < rows.Count; r++)
            {
                for (int c = 0; c < rows[r].Count; c++)
                {
                    var (cellHtml, header) = rows[r][c];
                    var tb = NewFlow(null);
                    tb.FontSize = 12.5;
                    if (header) tb.FontWeight = FontWeights.Bold;
                    AppendInlines(tb, cellHtml);
                    var cell = new Border
                    {
                        BorderBrush = Br("BorderBrush", "#3a3a3a"),
                        BorderThickness = new Thickness(0.5),
                        Background = header ? Br("BgHoverBrush", "#242424") : null,
                        Padding = new Thickness(8, 5, 8, 5),
                        Child = tb,
                    };
                    Grid.SetRow(cell, r);
                    Grid.SetColumn(cell, c);
                    grid.Children.Add(cell);
                }
            }
            target.Children.Add(grid);
        }

        private static Border Hr() => new()
        {
            Height = 1,
            Background = Br("BorderBrush", "#3a3a3a"),
            Margin = new Thickness(0, 6, 0, 12),
        };

        // ── Inline parser (strong/b, em/i, code, a, br) ──────────────────────
        private static void AppendInlines(TextBlock tb, string html)
        {
            int i = 0, bold = 0, italic = 0;
            bool code = false;
            string? href = null;

            void AddText(string raw)
            {
                if (raw.Length == 0) return;
                var run = new Run(WebUtility.HtmlDecode(raw));
                if (bold > 0) run.FontWeight = FontWeights.SemiBold;
                if (italic > 0) run.FontStyle = FontStyles.Italic;
                if (code) { run.FontFamily = Mono(); run.Foreground = Br("BlueBrush", "#0088f1"); }

                if (href != null && Uri.TryCreate(href, UriKind.Absolute, out var uri))
                {
                    var link = new Hyperlink(run)
                    {
                        NavigateUri = uri,
                        Foreground = Br("BlueBrush", "#0088f1"),
                        TextDecorations = TextDecorations.Underline,
                    };
                    link.RequestNavigate += (_, e) =>
                    {
                        try { Process.Start(new ProcessStartInfo(e.Uri.AbsoluteUri) { UseShellExecute = true }); } catch { }
                        e.Handled = true;
                    };
                    tb.Inlines.Add(link);
                }
                else tb.Inlines.Add(run);
            }

            while (i < html.Length)
            {
                int lt = html.IndexOf('<', i);
                if (lt < 0) { AddText(html[i..]); break; }
                if (lt > i) AddText(html[i..lt]);
                if (!TryReadTag(html, lt, out int te, out bool isClose, out _, out string name, out string attrs))
                { AddText("<"); i = lt + 1; continue; }

                switch (name)
                {
                    case "strong":
                    case "b": bold = Math.Max(0, bold + (isClose ? -1 : 1)); break;
                    case "em":
                    case "i": italic = Math.Max(0, italic + (isClose ? -1 : 1)); break;
                    case "code": code = !isClose; break;
                    case "a": href = isClose ? null : ExtractHref(attrs); break;
                    case "br": tb.Inlines.Add(new LineBreak()); break;
                        // any other inline/unknown tag: drop the tag, keep its text
                }
                i = te;
            }
        }

        // ── Low-level helpers ────────────────────────────────────────────────
        private static bool TryReadTag(string s, int pos, out int tagEnd, out bool isClose, out bool selfClose, out string name, out string attrs)
        {
            tagEnd = pos; isClose = false; selfClose = false; name = ""; attrs = "";
            if (pos >= s.Length || s[pos] != '<') return false;
            int gt = s.IndexOf('>', pos);
            if (gt < 0) return false;
            string body = s[(pos + 1)..gt].Trim();
            if (body.Length == 0) return false;
            if (body[0] == '/') { isClose = true; body = body[1..].Trim(); }
            if (body.EndsWith("/")) { selfClose = true; body = body[..^1].Trim(); }
            int sp = body.IndexOfAny(new[] { ' ', '\t', '\n', '\r' });
            if (sp < 0) name = body;
            else { name = body[..sp]; attrs = body[(sp + 1)..]; }
            name = name.ToLowerInvariant();
            tagEnd = gt + 1;
            return name.Length > 0;
        }

        // Returns index of the matching close tag's '<', or -1. `after` = index past its '>'.
        private static int FindMatchingClose(string s, string tag, int from, out int after)
        {
            int depth = 1, i = from;
            after = -1;
            while (i < s.Length)
            {
                int lt = s.IndexOf('<', i);
                if (lt < 0) break;
                if (TryReadTag(s, lt, out int te, out bool isClose, out bool self, out string name, out _))
                {
                    if (name == tag && !self)
                    {
                        if (isClose) { if (--depth == 0) { after = te; return lt; } }
                        else depth++;
                    }
                    i = te;
                }
                else i = lt + 1;
            }
            return -1;
        }

        private static bool ContainsBlock(string html) =>
            Regex.IsMatch(html, "<(ul|ol|p|pre|blockquote|h[1-6]|table)[ >]", RegexOptions.IgnoreCase);

        private static string ExtractHref(string attrs)
        {
            var m = Regex.Match(attrs, "href\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", RegexOptions.IgnoreCase);
            return m.Success ? (m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value) : "";
        }

        private static TextBlock NewFlow(string? text) => new()
        {
            Text = text ?? "",
            TextWrapping = TextWrapping.Wrap,
            FontSize = 13.5,
            LineHeight = 21,
            Foreground = Br("TextPrimaryBrush", "#ececec"),
        };

        private static FontFamily Mono() =>
            (Application.Current?.TryFindResource("MonoFontFamily") as FontFamily) ?? new FontFamily("Consolas");

        private static Brush Br(string key, string fallback)
        {
            if (Application.Current?.TryFindResource(key) is Brush b) return b;
            return (Brush)new BrushConverter().ConvertFromString(fallback)!;
        }
    }
}
