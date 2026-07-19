using System;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace ThalamusApp.Controls
{
    public partial class MessageBubble : System.Windows.Controls.UserControl
    {
        public MessageBubble() => InitializeComponent();

        public void SetMessage(string role, string text)
        {
            bool isUser = role == "user";

            RoleLabel.Text = isUser ? "You" : "Thalamus AI";

            BubbleBorder.SetResourceReference(System.Windows.Controls.Border.BackgroundProperty, "BgCardBrush");

            BubbleBorder.HorizontalAlignment = isUser
                ? HorizontalAlignment.Right
                : HorizontalAlignment.Left;

            // BlueBrush keeps the user label's accent now both bubbles share one bg
            RoleLabel.SetResourceReference(System.Windows.Controls.TextBlock.ForegroundProperty,
                isUser ? "BlueBrush" : "TextMutedBrush");

            RenderMarkdown(text);
        }

        public void AppendText(string chunk)
        {
            // Append to last paragraph for streaming updates
            var doc = ContentBox.Document;
            if (doc.Blocks.LastBlock is Paragraph p)
            {
                p.Inlines.Add(new Run(chunk));
            }
            else
            {
                var para = new Paragraph(new Run(chunk)) { Margin = new Thickness(0) };
                doc.Blocks.Add(para);
            }
        }

        private void RenderMarkdown(string text)
        {
            var doc = new FlowDocument { PagePadding = new Thickness(0) };
            doc.FontSize = 13;
            doc.FontFamily = new FontFamily("Segoe UI");
            doc.SetResourceReference(FlowDocument.ForegroundProperty, "TextPrimaryBrush");

            foreach (var rawLine in text.Split('\n'))
            {
                var line = rawLine;

                if (line.StartsWith("```") || line == "```")
                {
                    // Code fence line — render as code block paragraph
                    var codePara = new Paragraph
                    {
                        Padding        = new Thickness(10, 6, 10, 6),
                        Margin         = new Thickness(0, 4, 0, 4),
                        FontFamily     = new FontFamily("Consolas"),
                    };
                    codePara.SetResourceReference(TextElement.BackgroundProperty, "ConsoleBgBrush");
                    codePara.SetResourceReference(TextElement.ForegroundProperty, "GreenBrush");
                    codePara.Inlines.Add(new Run(line));
                    doc.Blocks.Add(codePara);
                    continue;
                }

                var para = new Paragraph { Margin = new Thickness(0, 2, 0, 2) };

                // Heading
                if (line.StartsWith("### ")) { para.FontSize = 14; para.FontWeight = FontWeights.Bold; line = line[4..]; }
                else if (line.StartsWith("## ")) { para.FontSize = 16; para.FontWeight = FontWeights.Bold; line = line[3..]; }
                else if (line.StartsWith("# "))  { para.FontSize = 18; para.FontWeight = FontWeights.Bold; line = line[2..]; }

                // Bullet
                if (line.StartsWith("- ") || line.StartsWith("* "))
                {
                    para.Margin = new Thickness(12, 1, 0, 1);
                    line = "• " + line[2..];
                }

                ParseInline(para, line);
                doc.Blocks.Add(para);
            }

            ContentBox.Document = doc;
        }

        private static void ParseInline(Paragraph para, string text)
        {
            int i = 0;
            while (i < text.Length)
            {
                // Bold **text**
                if (i + 1 < text.Length && text[i] == '*' && text[i + 1] == '*')
                {
                    int end = text.IndexOf("**", i + 2);
                    if (end >= 0)
                    {
                        var bold = new Bold(new Run(text[(i + 2)..end]));
                        para.Inlines.Add(bold);
                        i = end + 2;
                        continue;
                    }
                }

                // Inline code `text`
                if (text[i] == '`')
                {
                    int end = text.IndexOf('`', i + 1);
                    if (end >= 0)
                    {
                        var code = new Run(text[(i + 1)..end])
                        {
                            FontFamily  = new FontFamily("Consolas"),
                        };
                        // ConsoleBgBrush, not BgCardBrush — must stay visible on a BgCard bubble
                        code.SetResourceReference(TextElement.BackgroundProperty, "ConsoleBgBrush");
                        code.SetResourceReference(TextElement.ForegroundProperty, "GreenBrush");
                        para.Inlines.Add(code);
                        i = end + 1;
                        continue;
                    }
                }

                // Italic *text*
                if (text[i] == '*')
                {
                    int end = text.IndexOf('*', i + 1);
                    if (end >= 0)
                    {
                        para.Inlines.Add(new Italic(new Run(text[(i + 1)..end])));
                        i = end + 1;
                        continue;
                    }
                }

                // Plain character — accumulate into run
                int runStart = i;
                while (i < text.Length && text[i] != '*' && text[i] != '`') i++;
                if (i > runStart)
                    para.Inlines.Add(new Run(text[runStart..i]));
            }
        }
    }
}
