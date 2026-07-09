using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace ThalamusApp
{
    /// <summary>
    /// Advanced Auto-Update System for Thalamus AI
    /// Supports version checking, delta updates, background downloads, and rollback
    /// </summary>
    public class AutoUpdateSystem
    {
        private readonly string _installDir;
        private readonly string _updateDir;
        private readonly string _currentVersion;
        private readonly HttpClient _httpClient;
        private const string UPDATE_SERVER = "https://thalamus.dev/api/latest-version";
        private const string CHECK_INTERVAL_HOURS = "24";

        public class UpdateInfo
        {
            public string Version { get; set; } = string.Empty;
            public string DownloadUrl { get; set; } = string.Empty;
            public string Changelog { get; set; } = string.Empty;
            public string Checksum { get; set; } = string.Empty;
            public long Size { get; set; }
            public DateTime ReleaseDate { get; set; }
            public bool IsDelta { get; set; }
            public string? DeltaFrom { get; set; }
        }

        public class UpdateProgress
        {
            public long BytesDownloaded { get; set; }
            public long TotalBytes { get; set; }
            public int PercentComplete => (int)((BytesDownloaded * 100) / Math.Max(TotalBytes, 1));
            public string Status { get; set; } = string.Empty;
        }

        public event EventHandler<UpdateProgress>? ProgressChanged;
        public event EventHandler<string>? UpdateAvailable;
        public event EventHandler<string>? UpdateInstalled;
        public event EventHandler<string>? UpdateFailed;

        public AutoUpdateSystem(string installDir, string currentVersion)
        {
            _installDir = installDir;
            _currentVersion = currentVersion;
            _updateDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Thalamus", "Updates");
            
            Directory.CreateDirectory(_updateDir);
            _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        }

        /// <summary>
        /// Check for available updates
        /// </summary>
        public async Task<UpdateInfo?> CheckForUpdatesAsync()
        {
            try
            {
                var response = await _httpClient.GetAsync(UPDATE_SERVER);
                if (!response.IsSuccessStatusCode)
                    return null;

                var json = await response.Content.ReadAsStringAsync();
                var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                var latestVersion = root.GetProperty("version").GetString() ?? "";

                // Check if update is available
                if (CompareVersions(latestVersion, _currentVersion) <= 0)
                    return null;

                var updateInfo = new UpdateInfo
                {
                    Version = latestVersion,
                    DownloadUrl = root.GetProperty("downloadUrl").GetString() ?? "",
                    Changelog = root.TryGetProperty("changelog", out var cl) ? (cl.GetString() ?? "") : "",
                    Checksum = root.TryGetProperty("checksum", out var cs) ? (cs.GetString() ?? "") : "",
                    Size = root.TryGetProperty("size", out var sz) ? sz.GetInt64() : 0,
                    ReleaseDate = root.TryGetProperty("releaseDate", out var rd) ? DateTime.Parse(rd.GetString() ?? "") : DateTime.Now,
                    IsDelta = root.TryGetProperty("isDelta", out var id) && id.GetBoolean(),
                    DeltaFrom = root.TryGetProperty("deltaFrom", out var df) ? df.GetString() : null
                };

                return updateInfo;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error checking for updates: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Download update in background
        /// </summary>
        public async Task<bool> DownloadUpdateAsync(UpdateInfo updateInfo, CancellationToken cancellationToken = default)
        {
            try
            {
                var updateFile = Path.Combine(_updateDir, $"thalamus-{updateInfo.Version}.zip");
                
                // Delete existing update if present
                if (File.Exists(updateFile))
                    File.Delete(updateFile);

                using (var response = await _httpClient.GetAsync(updateInfo.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
                {
                    if (!response.IsSuccessStatusCode)
                        throw new Exception($"Download failed with status {response.StatusCode}");

                    var totalBytes = response.Content.Headers.ContentLength ?? 0;
                    var canReportProgress = totalBytes != 0;

                    using (var contentStream = await response.Content.ReadAsStreamAsync())
                    using (var fileStream = new FileStream(updateFile, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        var buffer = new byte[8192];
                        long totalRead = 0;
                        int bytesRead;

                        while ((bytesRead = await contentStream.ReadAsync(buffer, 0, buffer.Length, cancellationToken)) != 0)
                        {
                            await fileStream.WriteAsync(buffer, 0, bytesRead);
                            totalRead += bytesRead;

                            if (canReportProgress)
                            {
                                ProgressChanged?.Invoke(this, new UpdateProgress
                                {
                                    BytesDownloaded = totalRead,
                                    TotalBytes = totalBytes,
                                    Status = $"Downloading update... {(totalRead * 100 / totalBytes)}%"
                                });
                            }
                        }
                    }
                }

                // Verify checksum
                if (!string.IsNullOrEmpty(updateInfo.Checksum))
                {
                    if (!VerifyChecksum(updateFile, updateInfo.Checksum))
                    {
                        File.Delete(updateFile);
                        throw new Exception("Checksum verification failed");
                    }
                }

                ProgressChanged?.Invoke(this, new UpdateProgress
                {
                    BytesDownloaded = updateInfo.Size,
                    TotalBytes = updateInfo.Size,
                    Status = "Download complete"
                });

                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error downloading update: {ex.Message}");
                UpdateFailed?.Invoke(this, ex.Message);
                return false;
            }
        }

        /// <summary>
        /// Install downloaded update
        /// </summary>
        public async Task<bool> InstallUpdateAsync(UpdateInfo updateInfo)
        {
            try
            {
                var updateFile = Path.Combine(_updateDir, $"thalamus-{updateInfo.Version}.zip");
                if (!File.Exists(updateFile))
                    throw new Exception("Update file not found");

                // Create backup of current installation
                var backupDir = Path.Combine(_updateDir, $"backup-{_currentVersion}");
                await BackupCurrentInstallationAsync(backupDir);

                try
                {
                    // Extract update
                    var tempDir = Path.Combine(_updateDir, "temp");
                    if (Directory.Exists(tempDir))
                        Directory.Delete(tempDir, true);
                    
                    Directory.CreateDirectory(tempDir);
                    ZipFile.ExtractToDirectory(updateFile, tempDir);

                    // Apply delta update if applicable
                    if (updateInfo.IsDelta)
                    {
                        await ApplyDeltaUpdateAsync(tempDir, _installDir);
                    }
                    else
                    {
                        // Full update - copy all files
                        CopyDirectory(tempDir, _installDir);
                    }

                    // Clean up
                    Directory.Delete(tempDir, true);
                    File.Delete(updateFile);

                    // Update version file
                    await WriteVersionFileAsync(updateInfo.Version);

                    UpdateInstalled?.Invoke(this, $"Update to v{updateInfo.Version} installed successfully");
                    return true;
                }
                catch (Exception ex)
                {
                    // Rollback on failure
                    Debug.WriteLine($"Update installation failed, rolling back: {ex.Message}");
                    await RollbackToBackupAsync(backupDir);
                    throw;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error installing update: {ex.Message}");
                UpdateFailed?.Invoke(this, ex.Message);
                return false;
            }
        }

        /// <summary>
        /// Apply delta update (patch)
        /// </summary>
        private async Task ApplyDeltaUpdateAsync(string deltaDir, string targetDir)
        {
            // Delta updates contain:
            // - /added/ - new files
            // - /modified/ - changed files
            // - /deleted.txt - list of files to delete

            var addedDir = Path.Combine(deltaDir, "added");
            var modifiedDir = Path.Combine(deltaDir, "modified");
            var deletedFile = Path.Combine(deltaDir, "deleted.txt");

            // Copy added files
            if (Directory.Exists(addedDir))
            {
                CopyDirectory(addedDir, targetDir);
            }

            // Copy modified files
            if (Directory.Exists(modifiedDir))
            {
                CopyDirectory(modifiedDir, targetDir);
            }

            // Delete removed files
            if (File.Exists(deletedFile))
            {
                var deletedFiles = await File.ReadAllLinesAsync(deletedFile);
                foreach (var file in deletedFiles)
                {
                    var filePath = Path.Combine(targetDir, file);
                    if (File.Exists(filePath))
                        File.Delete(filePath);
                }
            }
        }

        /// <summary>
        /// Backup current installation
        /// </summary>
        private async Task BackupCurrentInstallationAsync(string backupDir)
        {
            Directory.CreateDirectory(backupDir);
            
            // Back up critical files
            var filesToBackup = new[] { "Thalamus.exe", "thalamus-vm-bridge.exe", "tvnviewer.exe" };
            
            foreach (var file in filesToBackup)
            {
                var source = Path.Combine(_installDir, file);
                var dest = Path.Combine(backupDir, file);
                
                if (File.Exists(source))
                {
                    File.Copy(source, dest, true);
                }
            }

            await Task.CompletedTask;
        }

        /// <summary>
        /// Rollback to backup
        /// </summary>
        private async Task RollbackToBackupAsync(string backupDir)
        {
            if (!Directory.Exists(backupDir))
                return;

            var filesToRestore = Directory.GetFiles(backupDir);
            foreach (var file in filesToRestore)
            {
                var dest = Path.Combine(_installDir, Path.GetFileName(file));
                File.Copy(file, dest, true);
            }

            await Task.CompletedTask;
        }

        /// <summary>
        /// Verify file checksum
        /// </summary>
        private bool VerifyChecksum(string filePath, string expectedChecksum)
        {
            try
            {
                using (var sha256 = SHA256.Create())
                using (var stream = File.OpenRead(filePath))
                {
                    var hash = sha256.ComputeHash(stream);
                    var hashString = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
                    return hashString.Equals(expectedChecksum.ToLowerInvariant());
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Copy directory recursively
        /// </summary>
        private void CopyDirectory(string sourceDir, string destDir)
        {
            Directory.CreateDirectory(destDir);

            foreach (var file in Directory.GetFiles(sourceDir))
            {
                var destFile = Path.Combine(destDir, Path.GetFileName(file));
                File.Copy(file, destFile, true);
            }

            foreach (var dir in Directory.GetDirectories(sourceDir))
            {
                var destSubDir = Path.Combine(destDir, Path.GetFileName(dir));
                CopyDirectory(dir, destSubDir);
            }
        }

        /// <summary>
        /// Write version file
        /// </summary>
        private async Task WriteVersionFileAsync(string version)
        {
            var versionFile = Path.Combine(_installDir, "version.txt");
            await File.WriteAllTextAsync(versionFile, version);
        }

        /// <summary>
        /// Compare two version strings
        /// Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
        /// </summary>
        private int CompareVersions(string v1, string v2)
        {
            var parts1 = v1.Split('.');
            var parts2 = v2.Split('.');

            for (int i = 0; i < Math.Max(parts1.Length, parts2.Length); i++)
            {
                var p1 = i < parts1.Length ? int.Parse(parts1[i]) : 0;
                var p2 = i < parts2.Length ? int.Parse(parts2[i]) : 0;

                if (p1 < p2) return -1;
                if (p1 > p2) return 1;
            }

            return 0;
        }

        /// <summary>
        /// Schedule periodic update checks
        /// </summary>
        public void SchedulePeriodicChecks(int intervalHours = 24)
        {
            var timer = new System.Timers.Timer(intervalHours * 60 * 60 * 1000);
            timer.Elapsed += async (s, e) =>
            {
                var updateInfo = await CheckForUpdatesAsync();
                if (updateInfo != null)
                {
                    UpdateAvailable?.Invoke(this, $"Update v{updateInfo.Version} available");
                    
                    // Auto-download in background
                    _ = DownloadUpdateAsync(updateInfo);
                }
            };
            timer.AutoReset = true;
            timer.Start();
        }

        /// <summary>
        /// Clean up old update files
        /// </summary>
        public void CleanupOldUpdates(int keepCount = 3)
        {
            try
            {
                var updateFiles = Directory.GetFiles(_updateDir, "thalamus-*.zip");
                
                if (updateFiles.Length > keepCount)
                {
                    var filesToDelete = new List<FileInfo>();
                    foreach (var file in updateFiles)
                    {
                        filesToDelete.Add(new FileInfo(file));
                    }

                    filesToDelete.Sort((a, b) => b.LastWriteTime.CompareTo(a.LastWriteTime));

                    for (int i = keepCount; i < filesToDelete.Count; i++)
                    {
                        File.Delete(filesToDelete[i].FullName);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error cleaning up updates: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Update Installer - Runs as separate process to replace files while app is closed
    /// </summary>
    public class UpdateInstaller
    {
        public static async Task<bool> InstallUpdateAsync(string updateFile, string targetDir, string backupDir)
        {
            try
            {
                // Wait for main application to close
                await WaitForProcessExitAsync("Thalamus");

                // Extract update
                var tempDir = Path.Combine(Path.GetTempPath(), "thalamus-update");
                if (Directory.Exists(tempDir))
                    Directory.Delete(tempDir, true);

                ZipFile.ExtractToDirectory(updateFile, tempDir);

                // Copy files
                foreach (var file in Directory.GetFiles(tempDir))
                {
                    var destFile = Path.Combine(targetDir, Path.GetFileName(file));
                    File.Copy(file, destFile, true);
                }

                // Clean up
                Directory.Delete(tempDir, true);
                File.Delete(updateFile);

                // Restart application
                var appPath = Path.Combine(targetDir, "Thalamus.exe");
                Process.Start(appPath);

                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Update installation failed: {ex.Message}");
                return false;
            }
        }

        private static async Task WaitForProcessExitAsync(string processName, int timeoutSeconds = 30)
        {
            var stopwatch = Stopwatch.StartNew();
            while (stopwatch.Elapsed.TotalSeconds < timeoutSeconds)
            {
                var processes = Process.GetProcessesByName(processName);
                if (processes.Length == 0)
                    return;

                await Task.Delay(500);
            }
        }
    }
}
