// Thalamus AI — MarkdownRenderer.h
#pragma once

#include <QObject>
#include <QString>

class MarkdownRenderer : public QObject
{
    Q_OBJECT

public:
    explicit MarkdownRenderer(QObject *parent = nullptr);
    ~MarkdownRenderer() = default;

    QString render(const QString &markdown) const;

private:
    QString escapeHtml(const QString &text) const;
};
