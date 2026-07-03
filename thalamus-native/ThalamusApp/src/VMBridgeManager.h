#ifndef VMBRIDGEMANAGER_H
#define VMBRIDGEMANAGER_H
#include <QObject>
class VMBridgeManager : public QObject { Q_OBJECT public: explicit VMBridgeManager(QObject *p = nullptr) : QObject(p) {} };
#endif
