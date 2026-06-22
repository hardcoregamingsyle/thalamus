using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ThalamusApp.Auth
{
    public static class AuthManager
    {
        private static readonly string CredFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Thalamus", "credentials.json");

        public static void SaveToken(string email, string token)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CredFile)!);
            var json = JsonSerializer.Serialize(new { email, token });
            var plain = Encoding.UTF8.GetBytes(json);
            var cipher = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(CredFile, cipher);
        }

        public static (string token, string email)? LoadToken()
        {
            try
            {
                if (!File.Exists(CredFile)) return null;
                var cipher = File.ReadAllBytes(CredFile);
                var plain  = ProtectedData.Unprotect(cipher, null, DataProtectionScope.CurrentUser);
                var json   = Encoding.UTF8.GetString(plain);
                var doc    = JsonDocument.Parse(json);
                var token  = doc.RootElement.GetProperty("token").GetString() ?? "";
                var email  = doc.RootElement.GetProperty("email").GetString() ?? "";
                if (string.IsNullOrEmpty(token)) return null;
                return (token, email);
            }
            catch { return null; }
        }

        public static void ClearToken()
        {
            try { if (File.Exists(CredFile)) File.Delete(CredFile); }
            catch { }
        }
    }
}
