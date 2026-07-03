#ifndef CONVEXCLIENT_H
#define CONVEXCLIENT_H

#include <QObject>
#include <QNetworkAccessManager>
#include <QString>

class ConvexClient : public QObject {
    Q_OBJECT

public:
    explicit ConvexClient(QObject *parent = nullptr);
    ~ConvexClient();

    void setAuthToken(const QString &token);
    void query(const QString &name, const QJsonObject &args);
    void mutate(const QString &name, const QJsonObject &args);

signals:
    void queryResult(const QJsonObject &result);
    void error(const QString &message);

private:
    QNetworkAccessManager *m_network;
    QString m_baseUrl;
    QString m_authToken;
};

#endif
