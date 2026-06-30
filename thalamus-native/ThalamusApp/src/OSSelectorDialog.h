// Thalamus AI — OSSelectorDialog.h
#pragma once

#include <QDialog>
#include <QListWidget>
#include <QDialogButtonBox>

class OSSelectorDialog : public QDialog
{
    Q_OBJECT

public:
    explicit OSSelectorDialog(QWidget *parent = nullptr);

    QString selectedOs() const;

private:
    void setupUi();

    QListWidget *m_osList;
    QString m_selectedOs;
};
