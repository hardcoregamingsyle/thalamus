using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThalamusApp.Services
{
    /// <summary>
    /// Runs a branch's &lt;&lt;RUN-CMD&gt;&gt; commands on this machine instead of in a
    /// Daytona cloud sandbox — the same way Claude Code works in a terminal.
    ///
    /// Each branch gets its own workspace under LocalAppData. The branch's
    /// generated files are written there before anything runs, so `npm test` or
    /// `tsc` execute against the real code rather than an empty directory.
    /// </summary>
    public static class LocalCommandRunner
    {
        // Matches the cloud executor so agents see the same limits either way.
        private const int CommandTimeoutMs = 150_000;
        private const int MaxOutputChars = 20_000;

        public static string WorkspaceRoot =>
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Thalamus", "workspaces");

        public static string WorkspaceFor(string branchId)
        {
            var dir = Path.Combine(WorkspaceRoot, Sanitize(branchId));
            Directory.CreateDirectory(dir);
            return dir;
        }

        // Branch ids are 10 chars of [A-Z0-9], but they arrive over the wire, so
        // never let one walk out of the workspace root.
        private static string Sanitize(string s)
        {
            var sb = new StringBuilder(s.Length);
            foreach (var c in s)
                if (char.IsLetterOrDigit(c) || c == '-' || c == '_') sb.Append(c);
            return sb.Length > 0 ? sb.ToString() : "branch";
        }

        /// <summary>
        /// Writes the branch's files into its workspace. Paths come from
        /// model-generated content, so anything that escapes the workspace root
        /// is skipped rather than trusted — a filepath of "../../.ssh/authorized_keys"
        /// is a plausible model mistake and an implausible thing to honour.
        /// </summary>
        public static int SyncFiles(string branchId, IEnumerable<(string Path, string Content)> files)
        {
            var root = WorkspaceFor(branchId);
            var rootFull = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
            int written = 0;

            foreach (var (relPath, content) in files)
            {
                if (string.IsNullOrWhiteSpace(relPath)) continue;
                string target;
                try
                {
                    target = Path.GetFullPath(Path.Combine(root, relPath.Replace('/', Path.DirectorySeparatorChar)));
                }
                catch { continue; }

                if (!target.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) continue;

                try
                {
                    var dir = Path.GetDirectoryName(target);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    // Skip the write when the content already matches, so a
                    // re-sync between commands doesn't churn every file's mtime
                    // and defeat incremental build tools.
                    if (File.Exists(target) && File.ReadAllText(target) == content) continue;
                    File.WriteAllText(target, content);
                    written++;
                }
                catch { /* one unwritable file must not stop the run */ }
            }
            return written;
        }

        /// <summary>
        /// Runs one command in the branch's workspace and returns its combined
        /// output and exit code. Never throws — a failure to launch is reported
        /// as output, because the pipeline is paused waiting for an answer and
        /// an exception here would strand the branch.
        /// </summary>
        public static async Task<(string Output, int ExitCode)> RunAsync(
            string branchId, string command, CancellationToken ct)
        {
            var workspace = WorkspaceFor(branchId);

            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/d /s /c " + "\"" + command + "\"",
                WorkingDirectory = workspace,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();

            try
            {
                if (!proc.Start())
                    return ($"[LOCAL ERROR: could not start a shell for: {command}]", 1);
            }
            catch (Exception ex)
            {
                return ($"[LOCAL ERROR: {ex.Message}]", 1);
            }

            // Drain both pipes concurrently. A command that fills the 4KB buffer
            // while nobody reads it blocks forever, which is the exact hazard
            // the QEMU launcher hit.
            var outTask = DrainAsync(proc.StandardOutput, stdout);
            var errTask = DrainAsync(proc.StandardError, stderr);

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(CommandTimeoutMs);

            try
            {
                await proc.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                TryKill(proc);
                var partial = Combine(stdout, stderr);
                var reason = ct.IsCancellationRequested ? "cancelled" : "exceeded 150s";
                return (Trim(partial + $"\n[TIMEOUT: command {reason} — background long-running processes or split the work]"), 124);
            }

            await Task.WhenAll(outTask, errTask).ConfigureAwait(false);
            return (Trim(Combine(stdout, stderr)), proc.ExitCode);
        }

        private static async Task DrainAsync(StreamReader reader, StringBuilder sink)
        {
            try
            {
                while (await reader.ReadLineAsync().ConfigureAwait(false) is { } line)
                {
                    if (sink.Length < MaxOutputChars) sink.AppendLine(line);
                }
            }
            catch { /* process died mid-read */ }
        }

        private static void TryKill(Process proc)
        {
            try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { }
        }

        private static string Combine(StringBuilder outBuf, StringBuilder errBuf)
        {
            if (errBuf.Length == 0) return outBuf.ToString();
            if (outBuf.Length == 0) return errBuf.ToString();
            return outBuf.ToString() + "\n" + errBuf.ToString();
        }

        private static string Trim(string s) =>
            s.Length <= MaxOutputChars ? s : s[..MaxOutputChars] + "\n[output truncated]";
    }
}
