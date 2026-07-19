using System;
using System.IO;
using System.Windows;

namespace ThalamusApp.Services
{
    // Runtime light/dark switching. Theme.xaml (dark) is always merged by
    // App.xaml; light mode works by merging Theme.Light.xaml ON TOP — later
    // merged dictionaries win resource lookup, and the add/remove invalidates
    // every DynamicResource reference so open windows repaint in place.
    // The choice persists to %LOCALAPPDATA%\Thalamus\theme (same folder as the
    // session file), mirroring the website's localStorage 'thalamus_theme'.
    public static class ThemeManager
    {
        private static readonly string ThemeFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Thalamus", "theme");

        private static ResourceDictionary? _lightOverlay;

        public static bool IsLight { get; private set; }

        // Called from App.OnStartup BEFORE any window is created, so the first
        // paint already uses the saved theme (no dark flash in light mode).
        public static void Initialize()
        {
            try
            {
                if (File.Exists(ThemeFile) &&
                    File.ReadAllText(ThemeFile).Trim().Equals("light", StringComparison.OrdinalIgnoreCase))
                {
                    Apply(light: true);
                }
            }
            catch { /* unreadable preference — dark default, same as the website */ }
        }

        public static void Toggle() => Apply(!IsLight);

        public static void Apply(bool light)
        {
            var merged = Application.Current.Resources.MergedDictionaries;

            if (light)
            {
                _lightOverlay ??= new ResourceDictionary
                {
                    Source = new Uri("pack://application:,,,/Styles/Theme.Light.xaml"),
                };
                if (!merged.Contains(_lightOverlay))
                    merged.Add(_lightOverlay);
            }
            else if (_lightOverlay != null)
            {
                merged.Remove(_lightOverlay);
            }

            IsLight = light;

            try
            {
                var dir = Path.GetDirectoryName(ThemeFile)!;
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(ThemeFile, light ? "light" : "dark");
            }
            catch { /* preference just won't survive a restart */ }
        }
    }
}
