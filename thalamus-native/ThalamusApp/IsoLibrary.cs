using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace ThalamusApp
{
    /// <summary>
    /// The OS image catalog for the VM Sandbox, plus download/storage management.
    ///
    /// Policy: every catalog entry points at an OFFICIAL, freely downloadable
    /// image (vendor evaluation or open-source release). Nothing is bundled
    /// with the app — images download on demand into %LOCALAPPDATA%\Thalamus\ISOs
    /// and can be deleted individually from the UI. Anything else (retail
    /// Windows, etc.) goes through the "Custom ISO" entry with a user-supplied
    /// file.
    /// </summary>
    public class IsoLibrary
    {
        public record IsoEntry(
            string Id,
            string Name,
            string Category,       // windows | android | linux | custom
            long SizeBytes,        // 0 = unknown (manual download / custom)
            string? DownloadUrl,   // null = no direct download (manual or custom)
            string? InfoUrl,       // official page to open in the browser
            string? FileName,      // target file name inside the ISO directory
            string Note);          // one-line hint shown under the entry name

        /// <summary>
        /// Verified 2026-07-12. Direct URLs were checked end-to-end (HTTP 200,
        /// Accept-Ranges: bytes, exact Content-Length recorded in SizeBytes).
        /// The Windows 11 eval has no stable direct URL — Microsoft gates it
        /// behind a registration form — so that entry links the official
        /// Evaluation Center page and the user picks the downloaded file.
        /// </summary>
        public static readonly IReadOnlyList<IsoEntry> Catalog = new IsoEntry[]
        {
            new("windows-11-eval", "Windows 11 Enterprise Evaluation", "windows",
                0, null,
                "https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise",
                "windows-11-enterprise-eval.iso",
                "Official 90-day eval — download from Microsoft, then locate the ISO"),

            new("android-x86-9", "Android-x86 9.0-r2 (64-bit)", "android",
                965_738_496,
                "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download",
                "https://www.android-x86.org/download.html",
                "android-x86_64-9.0-r2.iso",
                "Latest stable release published by the Android-x86 project"),

            new("ubuntu-2404", "Ubuntu 24.04.4 LTS Desktop", "linux",
                6_655_619_072,
                "https://releases.ubuntu.com/24.04/ubuntu-24.04.4-desktop-amd64.iso",
                "https://ubuntu.com/download/desktop",
                "ubuntu-24.04.4-desktop-amd64.iso",
                "Official release from releases.ubuntu.com"),

            new("debian-12", "Debian 12.15 Bookworm (netinst)", "linux",
                709_885_952,
                "https://cdimage.debian.org/cdimage/archive/12.15.0/amd64/iso-cd/debian-12.15.0-amd64-netinst.iso",
                "https://www.debian.org/distrib/",
                "debian-12.15.0-amd64-netinst.iso",
                "Official Debian archive — small installer, fetches the rest online"),

            new("kali-2026", "Kali Linux 2026.2 (installer)", "linux",
                4_802_531_328,
                "https://cdimage.kali.org/current/kali-linux-2026.2-installer-amd64.iso",
                "https://www.kali.org/get-kali/",
                "kali-linux-2026.2-installer-amd64.iso",
                "Official image from cdimage.kali.org"),

            new("custom", "Custom ISO…", "custom",
                0, null, null, null,
                "Boot any ISO you already own — pick the file from disk"),
        };

        private readonly string _isoDir;
        private readonly string _legacyIsoDir;   // <installDir>\isos from older installs
        private readonly string _mapFile;
        private readonly Dictionary<string, string> _manualPaths;
        private static readonly HttpClient _http = new();

        public string IsoDirectory => _isoDir;

        public IsoLibrary(string installDir)
        {
            var dataRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Thalamus");
            _isoDir       = Path.Combine(dataRoot, "ISOs");
            _legacyIsoDir = Path.Combine(installDir, "isos");
            _mapFile      = Path.Combine(dataRoot, "iso-paths.json");

            Directory.CreateDirectory(_isoDir);
            _manualPaths = LoadManualPaths();
        }

        // ── Path resolution ───────────────────────────────────────────────────

        /// <summary>
        /// Absolute path of a usable ISO for this entry, or null if nothing is
        /// available yet. Manual/custom picks win over downloaded files.
        /// </summary>
        public string? Resolve(string id)
        {
            if (_manualPaths.TryGetValue(id, out var manual) && File.Exists(manual))
                return manual;

            var entry = Find(id);
            if (entry?.FileName == null) return null;

            var downloaded = Path.Combine(_isoDir, entry.FileName);
            if (File.Exists(downloaded)) return downloaded;

            // Older installs kept ISOs next to the app — honour those too.
            var legacy = Path.Combine(_legacyIsoDir, entry.FileName);
            return File.Exists(legacy) ? legacy : null;
        }

        public bool IsDownloaded(IsoEntry e) =>
            e.FileName != null && File.Exists(Path.Combine(_isoDir, e.FileName));

        /// <summary>Bytes already saved by an interrupted download (0 = none).</summary>
        public long PartialBytes(IsoEntry e)
        {
            if (e.FileName == null) return 0;
            var partial = Path.Combine(_isoDir, e.FileName + ".partial");
            return File.Exists(partial) ? new FileInfo(partial).Length : 0;
        }

        public static IsoEntry? Find(string id)
        {
            foreach (var e in Catalog)
                if (e.Id == id) return e;
            return null;
        }

        // ── Download with resume ──────────────────────────────────────────────

        /// <summary>
        /// Download an entry's ISO into the ISO directory. Interrupted downloads
        /// leave a .partial file and are resumed with an HTTP Range request on
        /// the next attempt (every catalog mirror supports Accept-Ranges).
        /// Progress reports (bytesDone, bytesTotal).
        /// </summary>
        public async Task DownloadAsync(IsoEntry e, IProgress<(long done, long total)> progress, CancellationToken ct)
        {
            if (e.DownloadUrl == null || e.FileName == null)
                throw new InvalidOperationException($"{e.Name} has no direct download.");

            var final   = Path.Combine(_isoDir, e.FileName);
            var partial = final + ".partial";
            long existing = File.Exists(partial) ? new FileInfo(partial).Length : 0;

            using var req = new HttpRequestMessage(HttpMethod.Get, e.DownloadUrl);
            if (existing > 0)
                req.Headers.Range = new RangeHeaderValue(existing, null);

            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

            // Server ignored the Range request (or the partial predates a
            // catalog change) — start over rather than corrupt the file.
            bool resumed = existing > 0 && resp.StatusCode == System.Net.HttpStatusCode.PartialContent;
            if (!resumed) existing = 0;
            resp.EnsureSuccessStatusCode();

            long total = existing + (resp.Content.Headers.ContentLength ?? 0);
            if (total == existing && e.SizeBytes > 0) total = e.SizeBytes;

            await using (var src = await resp.Content.ReadAsStreamAsync(ct))
            await using (var dst = new FileStream(
                partial, resumed ? FileMode.Append : FileMode.Create,
                FileAccess.Write, FileShare.None, 1 << 16, useAsync: true))
            {
                var buf  = new byte[1 << 16];
                long done = existing;
                int n;
                // Throttle progress to ~8 reports/s — a multi-GB download reads
                // ~100k chunks and posting each one would flood the UI thread.
                var sw = System.Diagnostics.Stopwatch.StartNew();
                while ((n = await src.ReadAsync(buf, ct)) != 0)
                {
                    await dst.WriteAsync(buf.AsMemory(0, n), ct);
                    done += n;
                    if (sw.ElapsedMilliseconds >= 125 || done == total)
                    {
                        sw.Restart();
                        progress.Report((done, total));
                    }
                }
                progress.Report((done, total));
            }

            File.Move(partial, final, overwrite: true);
        }

        /// <summary>Delete the downloaded ISO (and any resume data) for an entry.</summary>
        public void Delete(IsoEntry e)
        {
            if (e.FileName != null)
            {
                var final = Path.Combine(_isoDir, e.FileName);
                if (File.Exists(final)) File.Delete(final);
                if (File.Exists(final + ".partial")) File.Delete(final + ".partial");
            }
            if (_manualPaths.Remove(e.Id))
                SaveManualPaths();
        }

        // ── Manual / custom ISO paths ─────────────────────────────────────────

        /// <summary>Remember a user-picked ISO file for an entry (eval or custom).</summary>
        public void SetManualPath(string id, string path)
        {
            _manualPaths[id] = path;
            SaveManualPaths();
        }

        public string? GetManualPath(string id) =>
            _manualPaths.TryGetValue(id, out var p) && File.Exists(p) ? p : null;

        private Dictionary<string, string> LoadManualPaths()
        {
            try
            {
                if (File.Exists(_mapFile))
                    return JsonSerializer.Deserialize<Dictionary<string, string>>(
                        File.ReadAllText(_mapFile)) ?? new();
            }
            catch { /* corrupt map file — start fresh */ }
            return new();
        }

        private void SaveManualPaths()
        {
            try
            {
                File.WriteAllText(_mapFile, JsonSerializer.Serialize(
                    _manualPaths, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { /* non-fatal — the pick just won't persist */ }
        }

        // ── Formatting helper ─────────────────────────────────────────────────

        public static string FormatBytes(long bytes) =>
            bytes >= 1_073_741_824 ? $"{bytes / 1_073_741_824.0:F1} GB"
            : bytes >= 1_048_576   ? $"{bytes / 1_048_576.0:F0} MB"
            : bytes >= 1024        ? $"{bytes / 1024.0:F0} KB"
                                   : $"{bytes} B";
    }
}
