#include "Settings.h"
#include <QVBoxLayout>
#include <QLabel>
Settings::Settings(QWidget *p) : QWidget(p) {
    auto *l = new QVBoxLayout(this);
    auto *h = new QLabel("Settings");
    h->setStyleSheet("font-size: 20px; font-weight: bold; color: #DCDCE1; padding: 8px 0;");
    auto *d = new QLabel("Configure application settings, API keys, and preferences.");
    d->setStyleSheet("color: #8B8B95; font-size: 13px;");
    d->setWordWrap(true);
    l->addWidget(h); l->addWidget(d); l->addStretch();
}
