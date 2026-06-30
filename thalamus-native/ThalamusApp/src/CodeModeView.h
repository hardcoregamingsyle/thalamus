// Thalamus AI — CodeModeView.h
#pragma once

#include <QWidget>
#include <QTextEdit>
#include <QLineEdit>
#include <QPushButton>
#include <QTreeWidget>
#include <QSplitter>
#include <QLabel>

class ConvexClient;
class MarkdownRenderer;

class CodeModeView : public QWidget
{
    Q_OBJECT

public:
    explicit CodeModeView(ConvexClient *client, QWidget *parent = nullptr);
    ~CodeModeView() = default;

private slots:
    void onExecutePrompt();
    void onStreamChunk(const QString &text);
    void onStreamDone();

private:
    void setupUi();
    void setInputEnabled(bool enabled);
    void addAgentLog(const QString &agentName, const QString &message);

    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;

    QLineEdit *m_promptInput;
    QPushButton *m_executeButton;
    QPushButton *m_stopButton;
    QTreeWidget *m_agentTree;
    QTextEdit *m_outputDisplay;
    QLabel *m_statusLabel;

    bool m_isRunning;
    QString m_currentOutput;
};
