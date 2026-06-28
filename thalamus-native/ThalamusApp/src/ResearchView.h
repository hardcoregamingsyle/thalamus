#ifndef RESEARCHVIEW_H
#define RESEARCHVIEW_H

#include <QWidget>
#include <QVBoxLayout>
#include <QTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QLabel>
#include <QJsonArray>
#include <QComboBox>
#include <QProgressBar>
#include "ConvexClient.h"
#include "MarkdownRenderer.h"

/**
 * @brief Deep Research mode — multi-round web research with comprehensive reports.
 */
class ResearchView : public QWidget
{
    Q_OBJECT

public:
    explicit ResearchView(ConvexClient *client, QWidget *parent = nullptr);
    ~ResearchView();

private slots:
    void onStartResearch();
    void onClearResearch();

private:
    void setupUI();
    void appendResult(const QString &title, const QString &content);
    QString renderReport(const QString &rawText);

    ConvexClient *m_client;
    MarkdownRenderer *m_mdRenderer;

    // UI
    QTextEdit *m_queryInput;
    QPushButton *m_researchBtn;
    QPushButton *m_clearBtn;
    QScrollArea *m_resultScroll;
    QWidget *m_resultContainer;
    QVBoxLayout *m_resultLayout;
    QLabel *m_statusLabel;
    QComboBox *m_depthCombo;
    QProgressBar *m_progressBar;

    // State
    bool m_isResearching;
    QString m_researchQuery;
    QString m_currentResearchResponse;
};

#endif // RESEARCHVIEW_H
