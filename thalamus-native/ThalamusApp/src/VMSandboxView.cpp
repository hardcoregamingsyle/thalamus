#include "VMSandboxView.h"
#include <QVBoxLayout>
#include <QLabel>
VMSandboxView::VMSandboxView(QWidget *p) : QWidget(p) {
    auto *l = new QVBoxLayout(this);
    auto *h = new QLabel("VM Sandbox");
    h->setStyleSheet("font-size: 20px; font-weight: bold; color: #DCDCE1; padding: 8px 0;");
    auto *d = new QLabel("Run VMs — Windows 11, Ubuntu, macOS, Android — with hardware acceleration.");
    d->setStyleSheet("color: #8B8B95; font-size: 13px;");
    d->setWordWrap(true);
    l->addWidget(h); l->addWidget(d); l->addStretch();
}
