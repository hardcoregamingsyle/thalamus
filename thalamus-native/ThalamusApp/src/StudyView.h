#ifndef STUDYVIEW_H
#define STUDYVIEW_H

#include <QWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QLabel>
#include <QJsonArray>
#include <QJsonObject>
#include <QComboBox>
#include <QListWidget>
#include <QProgressBar>
#include "ConvexClient.h"
#include "MarkdownRenderer.h"

/**
 * @brief Study mode — RAG-enhanced learning with knowledge graphs.
 *
 * Features: upload study materials, vector search, knowledge graph,
 * AI-powered tutoring based on uploaded content.
 */
class StudyView : public QWidget
{
    Q_OBJECT

public:
    explicit StudyView(ConvexClient *client, QWidget *parent = nullptr);
    ~StudyView();

private slots:
    void onAskQuestion();
    void onUploadMaterial();
    void onClearStudy();

private:
    void setupUI();
    void appendMessage(const QString &role, const QString &content);
    void loadResources();
    void addResourceItem(const QString &title, const QString &id);

    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;

    // UI
    QWidget *m_sidebar;
    QListWidget *m_resourceList;
    QPushButton *m_uploadBtn;

    QWidget *m_mainArea;
    QScrollArea *m_chatScroll;
    QWidget *m_chatContainer;
    QVBoxLayout *m_chatLayout;
    QTextEdit *m_questionInput;
    QPushButton *m_askBtn;
    QPushButton *m_clearBtn;
    QComboBox *m_modeCombo;
    QLabel *m_statusLabel;
    QProgressBar *m_progressBar;

    // State
    bool m_isAsking;
};

#endif // STUDYVIEW_H
