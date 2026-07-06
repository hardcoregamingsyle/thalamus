using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace ThalamusApp.Auth
{
    public static class AuthManager
    {
        private static readonly string AppDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Thalamus");

        private static readonly string SessionFile = Path.Combine(AppDataDir, "session.dat");

        public static void SaveToken(string token, string email)
        {
            try
            {
                if (!Directory.Exists(AppDataDir))
                    Directory.CreateDirectory(AppDataDir);

                var data = $"{token}\n{email}";
                var bytes = Encoding.UTF8.GetBytes(data);
                var encrypted = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(SessionFile, encrypted);
            }
            catch
            {
                // Fallback: store unencrypted if DPAPI fails
                var data = $"{token}\n{email}";
                File.WriteAllText(SessionFile, data);
            }
        }

        public static (string token, string email)? LoadToken()
        {
            try
            {
                if (!File.Exists(SessionFile))
                    return null;

                var encrypted = File.ReadAllBytes(SessionFile);
                byte[] bytes;

                try
                {
                    bytes = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                }
                catch
                {
                    // Fallback: read unencrypted
                    var raw = File.ReadAllText(SessionFile);
                    bytes = Encoding.UTF8.GetBytes(raw);
                }

                var data = Encoding.UTF8.GetString(bytes);
                var lines = data.Split('\n', 2);
                if (lines.Length == 2 && !string.IsNullOrEmpty(lines[0]))
                    return (lines[0].Trim(), lines[1].Trim());

                return null;
            }
            catch
            {
                return null;
            }
        }

        public static void ClearToken()
        {
            try
            {
                if (File.Exists(SessionFile))
                    File.Delete(SessionFile);
            }
            catch { }
        }
    }
}
