// Thalamus AI — StudyView.h
#pragma once

#include <QWidget>
#include <QTextEdit>
#include <QLineEdit>
#include <QPushButton>
#include <QListWidget>
#include <QSplitter>

class ConvexClient;
class MarkdownRenderer;

class StudyView : public QWidget
{
    Q_OBJECT

public:
    explicit StudyView(ConvexClient *client, QWidget *parent = nullptr);

private slots:
    void onAskQuestion();
    void onUploadMaterial();
    void onStreamChunk(const QString &text);
    void onStreamDone();

private:
    void setupUi();
    void setInputEnabled(bool en);
    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;
    QListWidget *m_materialList;
    QTextEdit *m_studyDisplay;
    QLineEdit *m_questionInput;
    QPushButton *m_askButton, *m_stopButton, *m_uploadButton;
    bool m_isStudying;
    QString m_currentAnswer;
};
