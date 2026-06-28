// System Resource Detection and VM Allocation
// Detects available RAM and CPU cores, recommends safe VM allocations

export interface SystemResources {
  totalRAM: number;        // Total system RAM in MB
  availableRAM: number;    // Available RAM in MB
  cpuCores: number;        // Logical CPU cores
  isAccurate: boolean;     // Whether detection is accurate
}

export interface VMResourceRecommendation {
  recommendedRAM: number;     // Recommended RAM in MB
  minRAM: number;            // Minimum RAM in MB
  maxRAM: number;            // Maximum RAM in MB
  recommendedCores: number;  // Recommended CPU cores
  minCores: number;          // Minimum cores
  maxCores: number;          // Maximum cores
  recommendedVRAM: number;   // Recommended VRAM in MB
}

/**
 * Detect system resources
 */
export function detectSystemResources(): SystemResources {
  let totalRAM = 4096; // Default 4GB if detection fails
  let isAccurate = false;

  // Try to detect RAM
  if ('deviceMemory' in navigator) {
    // Navigator.deviceMemory returns GB (approximate, rounded)
    totalRAM = (navigator as any).deviceMemory * 1024;
    isAccurate = true;
  } else if ('memory' in performance && (performance as any).memory) {
    // Chrome/Edge only: performance.memory gives more accurate values
    const memory = (performance as any).memory;
    if (memory.jsHeapSizeLimit) {
      // Estimate total RAM from heap limit (heap is typically ~25% of RAM)
      totalRAM = Math.round((memory.jsHeapSizeLimit / 1024 / 1024) * 4);
      isAccurate = true;
    }
  }

  // Detect CPU cores
  const cpuCores = navigator.hardwareConcurrency || 4; // Default to 4 if unavailable

  // Estimate available RAM (conservative: assume 60% is available)
  const availableRAM = Math.round(totalRAM * 0.6);

  return {
    totalRAM,
    availableRAM,
    cpuCores,
    isAccurate,
  };
}

/**
 * Calculate recommended VM resources for v86 (32-bit, lighter)
 */
export function getV86Recommendations(systemResources: SystemResources): VMResourceRecommendation {
  const { availableRAM, cpuCores } = systemResources;

  // v86 is single-threaded, but we can recommend based on OS type
  // For 32-bit OSes, we don't need much RAM

  // Recommended: Use 20-30% of available RAM for v86 (it's efficient)
  const recommendedRAM = Math.min(
    Math.max(512, Math.round(availableRAM * 0.25)),
    2048 // v86 rarely needs more than 2GB
  );

  // Min: 128MB for DOS, 256MB for Windows, 512MB for Linux
  const minRAM = 128;

  // Max: 2GB (32-bit limit is 4GB, but 2GB is practical)
  const maxRAM = Math.min(2048, Math.round(availableRAM * 0.5));

  // Recommended cores: 1 (v86 is single-threaded)
  const recommendedCores = 1;

  // VRAM: 8-16MB is enough for v86
  const recommendedVRAM = 16;

  return {
    recommendedRAM,
    minRAM,
    maxRAM,
    recommendedCores,
    minCores: 1,
    maxCores: 1, // v86 doesn't support multiple cores
    recommendedVRAM,
  };
}

/**
 * Calculate recommended VM resources for QEMU (64-bit, heavier)
 */
export function getQEMURecommendations(systemResources: SystemResources): VMResourceRecommendation {
  const { availableRAM, cpuCores } = systemResources;

  // QEMU needs more RAM for 64-bit OSes
  // Recommended: Use 30-40% of available RAM
  const recommendedRAM = Math.min(
    Math.max(2048, Math.round(availableRAM * 0.35)),
    8192 // 8GB is practical max for browser
  );

  // Min: 2GB for modern OSes
  const minRAM = 2048;

  // Max: 50% of available RAM, capped at 8GB (browser limit)
  const maxRAM = Math.min(8192, Math.round(availableRAM * 0.5));

  // Recommended cores: 50-75% of CPU cores
  const recommendedCores = Math.max(2, Math.min(4, Math.ceil(cpuCores * 0.6)));

  // Min: 2 cores for modern OS
  const minCores = 2;

  // Max: 75% of cores, capped at 4 (diminishing returns in browser)
  const maxCores = Math.min(4, Math.max(2, Math.floor(cpuCores * 0.75)));

  // VRAM: 64-128MB for modern OSes
  const recommendedVRAM = recommendedRAM >= 4096 ? 128 : 64;

  return {
    recommendedRAM,
    minRAM,
    maxRAM,
    recommendedCores,
    minCores,
    maxCores,
    recommendedVRAM,
  };
}

/**
 * Get OS-specific recommendations
 */
export function getOSRecommendations(osKey: string): { minRAM: number; recommendedRAM: number; minCores: number } {
  const recommendations: Record<string, { minRAM: number; recommendedRAM: number; minCores: number }> = {
    // v86 OSes (32-bit)
    "linux-alpine": { minRAM: 256, recommendedRAM: 512, minCores: 1 },
    "linux-debian": { minRAM: 512, recommendedRAM: 1024, minCores: 1 },
    "windows-xp": { minRAM: 256, recommendedRAM: 512, minCores: 1 },
    "windows-2000": { minRAM: 128, recommendedRAM: 256, minCores: 1 },
    "kolibrios": { minRAM: 32, recommendedRAM: 64, minCores: 1 },
    "freedos": { minRAM: 32, recommendedRAM: 64, minCores: 1 },

    // QEMU OSes (64-bit)
    "linux-ubuntu": { minRAM: 2048, recommendedRAM: 4096, minCores: 2 },
    "linux-fedora": { minRAM: 2048, recommendedRAM: 4096, minCores: 2 },
    "windows-11": { minRAM: 4096, recommendedRAM: 8192, minCores: 2 },
    "windows-10": { minRAM: 2048, recommendedRAM: 4096, minCores: 2 },
    "macos-ventura": { minRAM: 4096, recommendedRAM: 8192, minCores: 2 },
  };

  return recommendations[osKey] || { minRAM: 512, recommendedRAM: 1024, minCores: 1 };
}

/**
 * Format RAM value for display
 */
export function formatRAM(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`;
  }
  return `${mb}MB`;
}

/**
 * Format CPU cores for display
 */
export function formatCores(cores: number): string {
  return `${cores} core${cores !== 1 ? 's' : ''}`;
}
