#ifndef MARKDOWNRENDERER_H
#define MARKDOWNRENDERER_H
#include <QWidget>
#include <QTextEdit>
class MarkdownRenderer : public QWidget { Q_OBJECT public: explicit MarkdownRenderer(QWidget *p = nullptr) : QWidget(p) {} };
#endif
