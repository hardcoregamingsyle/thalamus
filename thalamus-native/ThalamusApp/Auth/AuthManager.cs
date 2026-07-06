using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace ThalamusApp.Auth
{
    /// <summary>
    /// Encrypted token storage for the Thalamus desktop app.
    /// Stores session tokens securely using DataProtectionScope.CurrentUser.
    /// </summary>
    public static class AuthManager
    {
        private static readonly string AppDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Thalamus"
        );

        private static readonly string TokenFile = Path.Combine(AppDir, "session.dat");

        /// <summary>
        /// Save token and email to encrypted file.
        /// </summary>
        public static void SaveToken(string token, string email)
        {
            try
            {
                if (!Directory.Exists(AppDir))
                    Directory.CreateDirectory(AppDir);

                var data = $"{token}|{email}";
                var bytes = Encoding.UTF8.GetBytes(data);
                var encrypted = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(TokenFile, encrypted);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[AuthManager] Save failed: {ex.Message}");
                // Fallback: save unencrypted (less secure but functional)
                File.WriteAllText(TokenFile, $"{token}|{email}");
            }
        }

        /// <summary>
        /// Load token and email from encrypted file.
        /// Returns null if no saved session exists.
        /// </summary>
        public static (string token, string email)? LoadToken()
        {
            try
            {
                if (!File.Exists(TokenFile))
                    return null;

                var encrypted = File.ReadAllBytes(TokenFile);
                byte[] bytes;

                try
                {
                    bytes = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                }
                catch
                {
                    // Fallback: try reading as plain text (legacy format)
                    var text = File.ReadAllText(TokenFile);
                    var parts = text.Split('|');
                    if (parts.Length >= 2)
                        return (parts[0], parts[1]);
                    return null;
                }

                var data = Encoding.UTF8.GetString(bytes);
                var parts2 = data.Split('|');
                if (parts2.Length >= 2)
                    return (parts2[0], parts2[1]);

                return null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Clear saved session.
        /// </summary>
        public static void ClearToken()
        {
            try
            {
                if (File.Exists(TokenFile))
                    File.Delete(TokenFile);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[AuthManager] Clear failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Check if a saved session exists.
        /// </summary>
        public static bool HasSession() => File.Exists(TokenFile);
    }
}
