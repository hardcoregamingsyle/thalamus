// Short relative time formatter ("Just now", "5m ago", "3h ago", "2d ago",
// falls back to a locale date string past a week). Duplicated ad-hoc in
// CodeProjects.tsx and CodeBranches.tsx; extracted here so future date-format
// call sites have one canonical helper to import.

export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// Compact timestamp for chat message rows. Recent times use the relative form;
// anything older falls back to a short clock time (e.g. "2:05 PM"). Returns an
// empty string when no time is stored (legacy messages written before the
// createdAt field existed).
export function formatMessageTime(ts?: number): string {
  if (!ts) return "";
  const now = Date.now();
  const diff = now - ts;
  const DAY = 86_400_000;
  if (diff < DAY) return formatRelative(ts, now);
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
