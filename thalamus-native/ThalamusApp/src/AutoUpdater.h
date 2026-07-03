#ifndef AUTOUPDATER_H
#define AUTOUPDATER_H
#include <QObject>
class AutoUpdater : public QObject { Q_OBJECT public: explicit AutoUpdater(QObject *p = nullptr) : QObject(p) {} };
#endif
