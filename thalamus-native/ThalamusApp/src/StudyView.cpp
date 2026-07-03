#include "StudyView.h"
#include <QVBoxLayout>
#include <QLabel>
StudyView::StudyView(QWidget *p) : QWidget(p) {
    auto *l = new QVBoxLayout(this);
    auto *h = new QLabel("Study");
    h->setStyleSheet("font-size: 20px; font-weight: bold; color: #DCDCE1; padding: 8px 0;");
    auto *d = new QLabel("Study mode — learn topics interactively with spaced repetition.");
    d->setStyleSheet("color: #8B8B95; font-size: 13px;");
    d->setWordWrap(true);
    l->addWidget(h); l->addWidget(d); l->addStretch();
}
