#ifndef VNCWIDGET_H
#define VNCWIDGET_H
#include <QWidget>
class VNCWidget : public QWidget { Q_OBJECT public: explicit VNCWidget(QWidget *p = nullptr) : QWidget(p) {} };
#endif
