using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;

namespace ThalamusApp
{
    /// <summary>
    /// Manages QEMU virtual machine instances and VNC port allocation.
    /// Replaces the Node.js bridge with native C# implementation.
    /// </summary>
    public class QemuBridgeManager
    {
        private readonly string _installDir;
        private readonly string _dataDir;
        private readonly Dictionary<string, VMInstance> _activeVMs = new();
        private int _nextVncPort = 5901;
        private const int MAX_VNC_PORTS = 100;

        public class VMInstance
        {
            public string Id { get; set; } = string.Empty;
            public Process? Process { get; set; }
            public string OS { get; set; } = string.Empty;
            public int VncPort { get; set; }
            public int RAM { get; set; }
            public int Cores { get; set; }
            public DateTime StartTime { get; set; }
        }

        public class BootResult
        {
            public bool Success { get; set; }
            public string VmId { get; set; } = string.Empty;
            public int VncPort { get; set; }
            public string? Error { get; set; }
            public string? IsoNeeded { get; set; }
        }

        public QemuBridgeManager(string installDir)
        {
            _installDir = installDir;
            _dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Thalamus", "VMs");
            
            Directory.CreateDirectory(_dataDir);
        }

        /// <summary>
        /// Check if QEMU is installed and accessible.
        /// </summary>
        public bool IsQemuInstalled()
        {
            try
            {
                var qemuPath = Path.Combine(_installDir, "qemu", "qemu-system-x86_64.exe");
                return File.Exists(qemuPath);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Get the path to QEMU executable.
        /// </summary>
        private string GetQemuBinary()
        {
            var qemuPath = Path.Combine(_installDir, "qemu", "qemu-system-x86_64.exe");
            if (File.Exists(qemuPath))
                return qemuPath;

            // Fallback to system PATH
            return "qemu-system-x86_64.exe";
        }

        /// <summary>
        /// Get the path to qemu-img executable.
        /// </summary>
        private string GetQemuImgBinary()
        {
            var qemuImgPath = Path.Combine(_installDir, "qemu", "qemu-img.exe");
            if (File.Exists(qemuImgPath))
                return qemuImgPath;

            return "qemu-img.exe";
        }

        /// <summary>
        /// Get or create a disk image for the OS.
        /// </summary>
        private string GetOrCreateDiskImage(string osId)
        {
            var diskPath = Path.Combine(_dataDir, $"{osId}-disk.qcow2");

            if (!File.Exists(diskPath))
            {
                try
                {
                    var qemuImg = GetQemuImgBinary();
                    var psi = new ProcessStartInfo(qemuImg, $"create -f qcow2 \"{diskPath}\" 60G")
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };

                    using (var process = Process.Start(psi))
                    {
                        process?.WaitForExit(30000); // 30 second timeout
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"Error creating disk image: {ex.Message}");
                }
            }

            return diskPath;
        }

        /// <summary>
        /// Find an available VNC port.
        /// </summary>
        private int FindAvailableVncPort()
        {
            for (int i = 0; i < MAX_VNC_PORTS; i++)
            {
                int port = 5901 + i;
                if (IsPortAvailable(port))
                    return port;
            }

            throw new Exception("No available VNC ports");
        }

        /// <summary>
        /// Check if a port is available.
        /// </summary>
        private bool IsPortAvailable(int port)
        {
            try
            {
                using (var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp))
                {
                    socket.Bind(new IPEndPoint(IPAddress.Loopback, port));
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Boot a virtual machine with the specified OS and configuration.
        /// </summary>
        public async Task<BootResult> BootVMAsync(string osId, int ram = 4096, int cores = 4)
        {
            try
            {
                // Check if VM is already running
                var existing = _activeVMs.Values.FirstOrDefault(vm => vm.OS == osId);
                if (existing != null)
                {
                    return new BootResult
                    {
                        Success = true,
                        VmId = existing.Id,
                        VncPort = existing.VncPort
                    };
                }

                // Get disk and VNC port
                var diskPath = GetOrCreateDiskImage(osId);
                var vncPort = FindAvailableVncPort();
                var vmId = $"{osId}-{DateTime.Now.Ticks}";

                // Get ISO path
                var isoPath = GetIsoPath(osId);
                if (!File.Exists(isoPath))
                {
                    return new BootResult
                    {
                        Success = false,
                        Error = "ISO not found",
                        IsoNeeded = isoPath
                    };
                }

                // Build QEMU arguments
                var args = BuildQemuArgs(osId, ram, cores, diskPath, isoPath, vncPort);

                // Start QEMU process
                var qemuBinary = GetQemuBinary();
                var psi = new ProcessStartInfo(qemuBinary, args)
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    WorkingDirectory = _installDir
                };

                var process = Process.Start(psi);
                if (process == null)
                {
                    return new BootResult
                    {
                        Success = false,
                        Error = "Failed to start QEMU process"
                    };
                }

                // Register VM instance
                var instance = new VMInstance
                {
                    Id = vmId,
                    Process = process,
                    OS = osId,
                    VncPort = vncPort,
                    RAM = ram,
                    Cores = cores,
                    StartTime = DateTime.Now
                };

                _activeVMs[vmId] = instance;

                // Monitor process for exit
                _ = Task.Run(() =>
                {
                    process.WaitForExit();
                    _activeVMs.Remove(vmId);
                });

                return new BootResult
                {
                    Success = true,
                    VmId = vmId,
                    VncPort = vncPort
                };
            }
            catch (Exception ex)
            {
                return new BootResult
                {
                    Success = false,
                    Error = ex.Message
                };
            }
        }

        /// <summary>
        /// Stop a running virtual machine.
        /// </summary>
        public async Task<bool> StopVMAsync(string vmId)
        {
            try
            {
                if (_activeVMs.TryGetValue(vmId, out var instance))
                {
                    instance.Process?.Kill();
                    _activeVMs.Remove(vmId);
                    return true;
                }

                return false;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// List all active virtual machines.
        /// </summary>
        public List<VMInstance> ListActiveVMs()
        {
            return _activeVMs.Values.ToList();
        }

        /// <summary>
        /// Get the ISO path for an OS.
        /// </summary>
        private string GetIsoPath(string osId)
        {
            var isoDir = Path.Combine(_installDir, "isos");
            
            var isoMappings = new Dictionary<string, string>
            {
                { "windows-11", "windows-11.iso" },
                { "windows-10", "windows-10.iso" },
                { "macos-18", "macos-sequoia-15.iso" },
                { "macos-17", "macos-sonoma-14.iso" },
                { "macos-16", "macos-ventura-13.iso" },
                { "macos-15", "macos-monterey-12.iso" },
                { "macos-14", "macos-big-sur-11.iso" },
                { "android-14", "android-14.iso" },
                { "android-13", "android-13.iso" },
                { "ubuntu-24", "ubuntu-24.04-lts.iso" },
                { "debian-12", "debian-12.iso" },
                { "kali-2024", "kali-linux-2024.iso" }
            };

            if (isoMappings.TryGetValue(osId, out var isoName))
            {
                return Path.Combine(isoDir, isoName);
            }

            return Path.Combine(isoDir, $"{osId}.iso");
        }

        /// <summary>
        /// Build QEMU command-line arguments.
        /// </summary>
        private string BuildQemuArgs(string osId, int ram, int cores, string diskPath, string isoPath, int vncPort)
        {
            var args = new List<string>
            {
                "-m", ram.ToString(),
                "-smp", cores.ToString(),
                "-machine", "type=q35",
                "-cpu", "qemu64",
                "-net", "nic,model=e1000",
                "-net", "user",
                "-vnc", $":{vncPort - 5900}",
                "-drive", $"file=\"{diskPath}\",format=qcow2,if=virtio",
                "-cdrom", $"\"{isoPath}\"",
                "-boot", "d"
            };

            // KVM acceleration — Linux only; not available on Windows
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                args.AddRange(new[] { "-enable-kvm" });
            }

            return string.Join(" ", args.Select(arg => arg.Contains(" ") ? $"\"{arg}\"" : arg));
        }

        /// <summary>
        /// Get disk usage information.
        /// </summary>
        public Dictionary<string, object> GetDiskInfo()
        {
            try
            {
                var diskDir = new DirectoryInfo(_dataDir);
                var totalSize = diskDir.GetFiles("*.qcow2")
                    .Sum(f => f.Length);

                return new Dictionary<string, object>
                {
                    { "totalSize", totalSize },
                    { "diskCount", diskDir.GetFiles("*.qcow2").Length },
                    { "path", _dataDir }
                };
            }
            catch
            {
                return new Dictionary<string, object>
                {
                    { "error", "Failed to get disk info" }
                };
            }
        }
    }
}
