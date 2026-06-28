#ifndef MARKDOWNRENDERER_H
#define MARKDOWNRENDERER_H

#include <QObject>
#include <QString>

/**
 * @brief Converts Markdown text to rich HTML for display in QLabel/QTextBrowser.
 *
 * Supports: headings, bold, italic, code blocks, inline code, lists,
 * blockquotes, links, and tables.
 */
class MarkdownRenderer : public QObject
{
    Q_OBJECT

public:
    explicit MarkdownRenderer(QObject *parent = nullptr);
    ~MarkdownRenderer();

    /**
     * @brief Render markdown text to HTML.
     * @param markdown The input markdown string.
     * @return HTML string suitable for QLabel with RichText format.
     */
    QString renderToHtml(const QString &markdown);

    /**
     * @brief Render markdown to plain text (strip formatting).
     */
    QString renderToPlainText(const QString &markdown);

private:
    QString escapeHtml(const QString &text);
    QString processInlineFormatting(const QString &line);
    QString processCodeBlocks(const QString &markdown);
};

#endif // MARKDOWNRENDERER_H
