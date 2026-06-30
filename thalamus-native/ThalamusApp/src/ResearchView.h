// Thalamus AI — ResearchView.h
#pragma once

#include <QWidget>
#include <QTextEdit>
#include <QLineEdit>
#include <QPushButton>
#include <QProgressBar>
#include <QTreeWidget>
#include <QSplitter>

class ConvexClient;
class MarkdownRenderer;

class ResearchView : public QWidget
{
    Q_OBJECT

public:
    explicit ResearchView(ConvexClient *client, QWidget *parent = nullptr);
    ~ResearchView() = default;

private slots:
    void onStartResearch();
    void onStreamChunk(const QString &text);
    void onStreamDone();

private:
    void setupUi();
    void setInputEnabled(bool enabled);

    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;

    QLineEdit *m_queryInput;
    QPushButton *m_startButton;
    QPushButton *m_stopButton;
    QProgressBar *m_progressBar;
    QTextEdit *m_resultDisplay;
    QTreeWidget *m_sourcesTree;

    bool m_isResearching;
    QString m_currentResult;
};
