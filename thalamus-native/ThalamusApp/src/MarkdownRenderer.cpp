// Thalamus AI — MarkdownRenderer.cpp
#include "MarkdownRenderer.h"
#include <QRegularExpression>

MarkdownRenderer::MarkdownRenderer(QObject *parent)
    : QObject(parent)
{}

QString MarkdownRenderer::render(const QString &markdown) const
{
    QString html = markdown;

    // Escape HTML entities first
    html = escapeHtml(html);

    // Headers (h1-h4)
    html.replace(QRegularExpression("^#### (.+)$", QRegularExpression::MultilineOption),
                 "<h4>\\1</h4>");
    html.replace(QRegularExpression("^### (.+)$", QRegularExpression::MultilineOption),
                 "<h3>\\1</h3>");
    html.replace(QRegularExpression("^## (.+)$", QRegularExpression::MultilineOption),
                 "<h2>\\1</h2>");
    html.replace(QRegularExpression("^# (.+)$", QRegularExpression::MultilineOption),
                 "<h1>\\1</h1>");

    // Bold and italic
    html.replace(QRegularExpression("\\*\\*(.+?)\\*\\*"), "<b>\\1</b>");
    html.replace(QRegularExpression("\\*(.+?)\\*"), "<i>\\1</i>");

    // Inline code
    html.replace(QRegularExpression("`([^`]+)`"), "<code>\\1</code>");

    // Code blocks (```...```)
    html.replace(QRegularExpression("```(?:\\w*)\\n([\\s\\S]*?)```"),
                 "<pre>\\1</pre>");

    // Links
    html.replace(QRegularExpression("\\[([^\\]]+)\\]\\(([^)]+)\\)"),
                 "<a href=\"\\2\">\\1</a>");

    // Unordered lists
    html.replace(QRegularExpression("^\\* (.+)$", QRegularExpression::MultilineOption),
                 "<li>\\1</li>");
    html.replace(QRegularExpression("(?:<li>.*</li>\\s*)+"),
                 "<ul>\\0</ul>");

    // Horizontal rules
    html.replace(QRegularExpression("^---+$", QRegularExpression::MultilineOption),
                 "<hr>");

    // Blockquotes
    html.replace(QRegularExpression("^> (.+)$", QRegularExpression::MultilineOption),
                 "<blockquote>\\1</blockquote>");

    // Paragraphs: wrap lines that aren't already wrapped in block elements
    QStringList lines = html.split('\n');
    QString result;
    bool inParagraph = false;

    for (const QString &line : lines) {
        QString trimmed = line.trimmed();
        if (trimmed.isEmpty()) {
            if (inParagraph) {
                result += "</p>\n";
                inParagraph = false;
            }
            result += "\n";
            continue;
        }

        // Skip lines already wrapped in block elements
        if (trimmed.startsWith('<') && (trimmed.startsWith("<h") || trimmed.startsWith("<ul") ||
            trimmed.startsWith("<li") || trimmed.startsWith("<pre") || trimmed.startsWith("<blockquote") ||
            trimmed.startsWith("<hr") || trimmed.startsWith("<div"))) {
            if (inParagraph) {
                result += "</p>\n";
                inParagraph = false;
            }
            result += line + "\n";
            continue;
        }

        if (trimmed.endsWith("</li>") || trimmed.endsWith("</ul>") ||
            trimmed.endsWith("</pre>") || trimmed.endsWith("</blockquote>") ||
            trimmed.endsWith("</h1>") || trimmed.endsWith("</h2>") ||
            trimmed.endsWith("</h3>") || trimmed.endsWith("</h4>") ||
            trimmed.endsWith("</hr>")) {
            if (inParagraph) {
                result += "</p>\n";
                inParagraph = false;
            }
            result += line + "\n";
            continue;
        }

        if (!inParagraph) {
            result += "<p>";
            inParagraph = true;
        } else {
            result += "\n";
        }
        result += trimmed;
    }

    if (inParagraph)
        result += "</p>\n";

    return result;
}

QString MarkdownRenderer::escapeHtml(const QString &text) const
{
    QString result = text;
    result.replace("&", "&amp;");
    result.replace("<", "&lt;");
    result.replace(">", "&gt;");
    return result;
}
