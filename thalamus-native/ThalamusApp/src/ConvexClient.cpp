#include "ConvexClient.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkRequest>
#include <QNetworkReply>

ConvexClient::ConvexClient(QObject *parent)
    : QObject(parent)
    , m_network(new QNetworkAccessManager(this))
    , m_baseUrl("https://thalamus.ai/api")
{
}

ConvexClient::~ConvexClient() = default;

void ConvexClient::setAuthToken(const QString &token)
{
    m_authToken = token;
}

void ConvexClient::query(const QString &name, const QJsonObject &args)
{
    QNetworkRequest request(QUrl(m_baseUrl + "/query"));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    if (!m_authToken.isEmpty())
        request.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());

    QJsonObject body;
    body["name"] = name;
    body["args"] = args;

    auto *reply = m_network->post(request, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        if (reply->error() == QNetworkReply::NoError) {
            emit queryResult(QJsonDocument::fromJson(reply->readAll()).object());
        } else {
            emit error(reply->errorString());
        }
        reply->deleteLater();
    });
}

void ConvexClient::mutate(const QString &name, const QJsonObject &args)
{
    // Mutations use same pattern as queries but with mutation endpoint
    QNetworkRequest request(QUrl(m_baseUrl + "/mutation"));
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    if (!m_authToken.isEmpty())
        request.setRawHeader("Authorization", ("Bearer " + m_authToken).toUtf8());

    QJsonObject body;
    body["name"] = name;
    body["args"] = args;

    auto *reply = m_network->post(request, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        if (reply->error() == QNetworkReply::NoError) {
            emit queryResult(QJsonDocument::fromJson(reply->readAll()).object());
        } else {
            emit error(reply->errorString());
        }
        reply->deleteLater();
    });
}
