using System;
using System.Windows;
using System.Threading;

namespace ThalamusApp
{
    public partial class App : Application
    {
        private static Mutex? _mutex;

        protected override void OnStartup(StartupEventArgs e)
        {
            // Single instance check
            _mutex = new Mutex(true, "ThalamusAI_SingleInstance", out bool createdNew);
            if (!createdNew)
            {
                // Bring existing window to front
                MessageBox.Show("Thalamus AI is already running.", "Thalamus AI", MessageBoxButton.OK, MessageBoxImage.Information);
                Shutdown();
                return;
            }

            base.OnStartup(e);
        }

        protected override void OnExit(ExitEventArgs e)
        {
            _mutex?.ReleaseMutex();
            _mutex?.Dispose();
            base.OnExit(e);
        }
    }
}
