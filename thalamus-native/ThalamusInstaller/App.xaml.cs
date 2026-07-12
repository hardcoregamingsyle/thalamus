using System;
using System.Linq;
using System.Windows;

namespace ThalamusInstaller
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // The ARP UninstallString runs "ThalamusSetup.exe /uninstall" —
            // route that to the uninstall flow instead of a fresh install.
            bool uninstall = e.Args.Any(a =>
                a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase) ||
                a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase));

            Window window = uninstall ? new UninstallWindow() : new InstallerWindow();
            window.Show();
        }
    }
}
