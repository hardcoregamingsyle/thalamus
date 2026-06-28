#include "MarkdownRenderer.h"
#include <QRegularExpression>

MarkdownRenderer::MarkdownRenderer(QObject *parent) : QObject(parent) {}
MarkdownRenderer::~MarkdownRenderer() {}

QString MarkdownRenderer::escapeHtml(const QString &text)
{
    QString result = text;
    result.replace("&", "&amp;");
    result.replace("<", "&lt;");
    result.replace(">", "&gt;");
    result.replace("\"", "&quot;");
    return result;
}

QString MarkdownRenderer::renderToHtml(const QString &markdown)
{
    if (markdown.isEmpty()) return "";

    QString html;
    bool inCodeBlock = false;
    bool inParagraph = false;

    const QStringList lines = markdown.split('\n');

    // First pass: extract code blocks
    QString processed = processCodeBlocks(markdown);
    QStringList processedLines = processed.split('\n');

    for (int i = 0; i < processedLines.size(); ++i) {
        const QString &line = processedLines[i];
        QString trimmed = line.trimmed();

        // Code block markers
        if (trimmed.startsWith("```")) {
            if (inCodeBlock) {
                html += "</code></pre>\n";
                inCodeBlock = false;
            } else {
                if (inParagraph) { html += "</p>\n"; inParagraph = false; }
                html += "<pre><code class=\"language-";
                QString lang = trimmed.mid(3).trimmed();
                html += (lang.isEmpty() ? "plaintext" : escapeHtml(lang));
                html += "\">";
                inCodeBlock = true;
            }
            continue;
        }

        if (inCodeBlock) {
            html += escapeHtml(line) + "\n";
            continue;
        }

        // Blank line = paragraph break
        if (trimmed.isEmpty()) {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            continue;
        }

        // Headings
        if (trimmed.startsWith("### ")) {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            html += "<h3>" + processInlineFormatting(escapeHtml(trimmed.mid(4))) + "</h3>\n";
            continue;
        }
        if (trimmed.startsWith("## ")) {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            html += "<h2>" + processInlineFormatting(escapeHtml(trimmed.mid(3))) + "</h2>\n";
            continue;
        }
        if (trimmed.startsWith("# ")) {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            html += "<h1>" + processInlineFormatting(escapeHtml(trimmed.mid(2))) + "</h1>\n";
            continue;
        }

        // Blockquotes
        if (trimmed.startsWith("> ")) {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            html += "<blockquote>" + processInlineFormatting(escapeHtml(trimmed.mid(2))) + "</blockquote>\n";
            continue;
        }

        // Unordered lists
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            html += "<li>" + processInlineFormatting(escapeHtml(trimmed.mid(2).trimmed())) + "</li>\n";
            continue;
        }

        // Ordered lists
        static QRegularExpression olRegex("^\\d+\\.\\s+(.*)");
        auto match = olRegex.match(trimmed);
        if (match.hasMatch()) {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            html += "<li>" + processInlineFormatting(escapeHtml(match.captured(1).trimmed())) + "</li>\n";
            continue;
        }

        // Horizontal rule
        if (trimmed == "---" || trimmed == "***" || trimmed == "___") {
            if (inParagraph) { html += "</p>\n"; inParagraph = false; }
            html += "<hr>\n";
            continue;
        }

        // Regular paragraph text
        if (!inParagraph) {
            html += "<p>";
            inParagraph = true;
        } else {
            html += "<br>\n";
        }
        html += processInlineFormatting(escapeHtml(line));
    }

    if (inCodeBlock) html += "</code></pre>\n";
    if (inParagraph) html += "</p>\n";

    // Wrap in a styled div
    return "<div class='markdown'>" + html + "</div>";
}

QString MarkdownRenderer::processInlineFormatting(const QString &text)
{
    QString result = text;

    // Bold: **text** or __text__
    static QRegularExpression boldRegex("\\*\\*(.+?)\\*\\*");
    result.replace(boldRegex, "<strong>\\1</strong>");
    static QRegularExpression boldRegex2("__(.+?)__");
    result.replace(boldRegex2, "<strong>\\1</strong>");

    // Italic: *text* or _text_
    static QRegularExpression italicRegex("\\*(.+?)\\*");
    result.replace(italicRegex, "<em>\\1</em>");
    static QRegularExpression italicRegex2("_(.+?)_");
    result.replace(italicRegex2, "<em>\\1</em>");

    // Strikethrough: ~~text~~
    static QRegularExpression strikeRegex("~~(.+?)~~");
    result.replace(strikeRegex, "<s>\\1</s>");

    // Inline code: `code`
    static QRegularExpression codeRegex("`(.+?)`");
    result.replace(codeRegex, "<code style='background:#2a2a2a; padding:2px 6px; border-radius:3px; font-family:monospace;'>\\1</code>");

    // Links: [text](url)
    static QRegularExpression linkRegex("\\[(.+?)\\]\\((.+?)\\)");
    result.replace(linkRegex, "<a href='\\2' style='color:#a78bfa;'>\\1</a>");

    return result;
}

QString MarkdownRenderer::processCodeBlocks(const QString &markdown)
{
    // Replace code blocks with markers (already handled in renderToHtml)
    return markdown;
}

QString MarkdownRenderer::renderToPlainText(const QString &markdown)
{
    if (markdown.isEmpty()) return "";

    QString result = markdown;
    // Remove code block markers
    result.replace(QRegularExpression("```[a-zA-Z]*\\n?"), "");
    // Remove headers
    result.replace(QRegularExpression("^#{1,6}\\s+"), "");
    // Remove bold/italic markers
    result.replace(QRegularExpression("[*_~`]{1,3}"), "");
    // Remove links (keep text)
    result.replace(QRegularExpression("\\[(.+?)\\]\\(.+?\\)"), "\\1");
    // Remove images
    result.replace(QRegularExpression("!\\[(.*?)\\]\\(.*?\\)"), "\\1");
    // Remove blockquote
    result.replace(QRegularExpression("^>\\s+"), "");
    // Remove list markers
    result.replace(QRegularExpression("^[-*+]\\s+"), "");
    result.replace(QRegularExpression("^\\d+\\.\\s+"), "");
    // Remove horizontal rules
    result.replace(QRegularExpression("^[-*_]{3,}$"), "");
    // Decode HTML entities
    result.replace("&amp;", "&");
    result.replace("&lt;", "<");
    result.replace("&gt;", ">");
    result.replace("&quot;", "\"");

    return result.trimmed();
}
