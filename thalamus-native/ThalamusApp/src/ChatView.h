#ifndef CHATVIEW_H
#define CHATVIEW_H
#include <QWidget>
#include <QTextEdit>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>
class ChatView : public QWidget {
    Q_OBJECT
public:
    explicit ChatView(QWidget *parent = nullptr);
private:
    QTextEdit *m_display;
    QLineEdit *m_input;
    QPushButton *m_sendBtn;
};
#endif
