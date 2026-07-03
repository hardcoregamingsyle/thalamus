#ifndef NOTIFICATIONMANAGER_H
#define NOTIFICATIONMANAGER_H
#include <QObject>
class NotificationManager : public QObject { Q_OBJECT public: explicit NotificationManager(QObject *p = nullptr) : QObject(p) {} };
#endif
