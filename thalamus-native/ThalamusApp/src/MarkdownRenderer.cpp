// Thalamus AI — MarkdownRenderer.cpp
#include "MarkdownRenderer.h"
#include <QRegularExpression>

MarkdownRenderer::MarkdownRenderer(QObject *parent) : QObject(parent) {}

QString MarkdownRenderer::render(const QString &md) const
{
    QString html = md;
    html.replace("&","&amp;"); html.replace("<","&lt;"); html.replace(">","&gt;");
    html.replace(QRegularExpression("^#### (.+)$", QRegularExpression::MultilineOption), "<h4>\\1</h4>");
    html.replace(QRegularExpression("^### (.+)$", QRegularExpression::MultilineOption), "<h3>\\1</h3>");
    html.replace(QRegularExpression("^## (.+)$", QRegularExpression::MultilineOption), "<h2>\\1</h2>");
    html.replace(QRegularExpression("^# (.+)$", QRegularExpression::MultilineOption), "<h1>\\1</h1>");
    html.replace(QRegularExpression("\\*\\*(.+?)\\*\\*"), "<b>\\1</b>");
    html.replace(QRegularExpression("\\*(.+?)\\*"), "<i>\\1</i>");
    html.replace(QRegularExpression("`([^`]+)`"), "<code>\\1</code>");
    html.replace(QRegularExpression("```(?:\\w*)\\n([\\s\\S]*?)```"), "<pre>\\1</pre>");
    html.replace(QRegularExpression("\\[([^\\]]+)\\]\\(([^)]+)\\)"), "<a href=\"\\2\">\\1</a>");
    html.replace(QRegularExpression("^\\* (.+)$", QRegularExpression::MultilineOption), "<li>\\1</li>");
    html.replace(QRegularExpression("(?:<li>.*</li>\\s*)+"), "<ul>\\0</ul>");
    html.replace(QRegularExpression("^---+$", QRegularExpression::MultilineOption), "<hr>");
    html.replace(QRegularExpression("^> (.+)$", QRegularExpression::MultilineOption), "<blockquote>\\1</blockquote>");

    QStringList lines = html.split('\n');
    QString result; bool inP = false;
    for (const QString &line : lines) {
        QString t = line.trimmed();
        if (t.isEmpty()) { if (inP) { result+="</p>\n"; inP=false; } result+="\n"; continue; }
        if (t.startsWith('<') && (t.startsWith("<h")||t.startsWith("<ul")||t.startsWith("<li")||
            t.startsWith("<pre")||t.startsWith("<blockquote")||t.startsWith("<hr"))) {
            if (inP) { result+="</p>\n"; inP=false; } result+=line+"\n"; continue; }
        if (!inP) { result+="<p>"; inP=true; } else result+="\n";
        result += t;
    }
    if (inP) result+="</p>\n";
    return result;
}
