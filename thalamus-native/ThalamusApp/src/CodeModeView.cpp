#include "CodeModeView.h"
#include <QVBoxLayout>
#include <QLabel>
CodeModeView::CodeModeView(QWidget *p) : QWidget(p) {
    auto *l = new QVBoxLayout(this);
    auto *h = new QLabel("Code Mode");
    h->setStyleSheet("font-size: 20px; font-weight: bold; color: #DCDCE1; padding: 8px 0;");
    auto *d = new QLabel("Code with AI — generate, review, and deploy code projects.");
    d->setStyleSheet("color: #8B8B95; font-size: 13px;");
    d->setWordWrap(true);
    l->addWidget(h); l->addWidget(d); l->addStretch();
}
