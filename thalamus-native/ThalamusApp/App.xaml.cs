using System;
using System.Threading;
using System.Windows;
using ThalamusApp.Auth;

namespace ThalamusApp
{
    public partial class App : Application
    {
        private static Mutex? _mutex;

        protected override void OnStartup(StartupEventArgs e)
        {
            // Global exception handler — shows error instead of silently crashing
            DispatcherUnhandledException += (_, ex) =>
            {
                MessageBox.Show(
                    $"Thalamus crashed:\n\n{ex.Exception.Message}\n\n{ex.Exception.StackTrace}",
                    "Thalamus Error", MessageBoxButton.OK, MessageBoxImage.Error);
                ex.Handled = true;
                Shutdown(1);
            };

            _mutex = new Mutex(true, "ThalamusAI_v1_SingleInstance", out bool created);
            if (!created)
            {
                BringExistingWindowToFront();
                Shutdown();
                return;
            }
            base.OnStartup(e);

            try
            {
                // ── No auth gate — open MainWindow directly (guest mode) ──
                var main = new MainWindow();
                var handler = new LoginHandler();

                if (handler.TryRestoreSession())
                    main.SetSession(handler.Token, handler.Email);

                main.Show();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Failed to start:\n\n{ex.Message}\n\n{ex.StackTrace}",
                    "Thalamus Startup Error", MessageBoxButton.OK, MessageBoxImage.Error);
                Shutdown(1);
            }
        }

        protected override void OnExit(ExitEventArgs e)
        {
            _mutex?.ReleaseMutex();
            _mutex?.Dispose();
            base.OnExit(e);
        }

        private static void BringExistingWindowToFront()
        {
            try
            {
                var hwnd = FindThalamusHwnd();
                if (hwnd == IntPtr.Zero) return;
                ShowWindow(hwnd, 9);
                SetForegroundWindow(hwnd);
            }
            catch { }
        }

        private static IntPtr FindThalamusHwnd()
        {
            IntPtr result = IntPtr.Zero;
            EnumWindows((hwnd, _) =>
            {
                var buf = new System.Text.StringBuilder(256);
                GetWindowText(hwnd, buf, 256);
                if (buf.ToString().Contains("Thalamus AI"))
                {
                    result = hwnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return result;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
        private static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder lpString, int nMaxCount);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hwnd);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);
    }
}
