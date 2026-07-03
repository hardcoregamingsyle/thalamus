#include <QApplication>
#include "MainWindow.h"

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    app.setApplicationName("Thalamus AI");
    app.setApplicationVersion("1.0.0");
    app.setOrganizationName("Thalamus AI");
    app.setQuitOnLastWindowClosed(false);

    MainWindow window;
    window.show();

    return app.exec();
}
