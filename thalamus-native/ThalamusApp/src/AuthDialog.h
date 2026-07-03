#ifndef AUTH_DIALOG_H
#define AUTH_DIALOG_H

#include <QDialog>

class AuthDialog : public QDialog {
    Q_OBJECT
public:
    explicit AuthDialog(QWidget *parent = nullptr);
};

#endif
