#ifndef OSSELECTORDIALOG_H
#define OSSELECTORDIALOG_H

#include <QDialog>
#include <QVBoxLayout>
#include <QListWidget>
#include <QLabel>
#include <QPushButton>
#include <QJsonObject>

/**
 * @brief OS selection dialog for VM boot with categorized OS list.
 *
 * Shows operating systems in categories:
 * - Windows (10/11)
 * - Linux (Ubuntu, Fedora, Debian, Alpine)
 * - macOS
 * - Android
 * - Other (FreeDOS, etc.)
 */
class OSSelectorDialog : public QDialog
{
    Q_OBJECT

public:
    explicit OSSelectorDialog(QWidget *parent = nullptr);
    ~OSSelectorDialog();

    QString selectedOS() const { return m_selectedOS; }
    QString selectedOSName() const;

private slots:
    void onItemClicked(QListWidgetItem *item);
    void onBootClicked();

private:
    void setupUI();
    void addOSCategory(const QString &name, const QJsonObject &oses);

    QListWidget *m_osList;
    QLabel *m_osInfo;
    QPushButton *m_bootBtn;
    QPushButton *m_cancelBtn;

    QString m_selectedOS;
    QString m_selectedOSName;
    QJsonObject m_osDetails;

    struct OSEntry {
        QString id;
        QString name;
        QString description;
        int minRam;
        int minCores;
    };
};

#endif // OSSELECTORDIALOG_H
