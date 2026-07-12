import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Admin management ───────────────────────────────────────────────────────

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
function requireAdmin(token: string) {
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

export const addIsoEntry = mutation({
  args: {
    adminToken: v.string(),
    name: v.string(),
    category: v.string(),
    downloadUrl: v.string(),
    fileName: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    infoUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    hostSkipVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    const name = args.name.trim();
    const downloadUrl = args.downloadUrl.trim();
    if (!name || !downloadUrl) throw new Error("Name and download URL are required");

    // Derive a filename from the URL when the admin doesn't supply one — the
    // last path segment, query string stripped.
    const fileName = args.fileName?.trim() || (() => {
      try {
        const u = new URL(downloadUrl);
        const last = u.pathname.split("/").filter(Boolean).pop();
        return last && last.length > 0 ? last : `${name.replace(/[^a-z0-9.-]+/gi, "-")}.iso`;
      } catch {
        return `${name.replace(/[^a-z0-9.-]+/gi, "-")}.iso`;
      }
    })();

    await ctx.db.insert("desktopIsoCatalog", {
      name,
      category: args.category,
      downloadUrl,
      fileName,
      sizeBytes: args.sizeBytes,
      infoUrl: args.infoUrl?.trim() || undefined,
      note: args.note?.trim() || undefined,
      hostSkipVersion: args.hostSkipVersion || undefined,
      isEnabled: true,
      createdAt: Date.now(),
      updatedBy: "admin",
    });
  },
});

export const setIsoEntryEnabled = mutation({
  args: { adminToken: v.string(), id: v.id("desktopIsoCatalog"), isEnabled: v.boolean() },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    await ctx.db.patch(args.id, { isEnabled: args.isEnabled });
  },
});

export const deleteIsoEntry = mutation({
  args: { adminToken: v.string(), id: v.id("desktopIsoCatalog") },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    await ctx.db.delete(args.id);
  },
});

export const listIsoEntriesAdmin = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    return await ctx.db.query("desktopIsoCatalog").order("desc").take(200);
  },
});

// ── Public: the desktop app fetches this, no auth needed (just a URL list) ──

export const listIsoEntriesPublic = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("desktopIsoCatalog").order("desc").take(200);
    return rows.filter((r) => r.isEnabled).map((r) => ({
      id: `admin-${r._id}`,
      name: r.name,
      category: r.category,
      downloadUrl: r.downloadUrl,
      fileName: r.fileName ?? null,
      sizeBytes: r.sizeBytes ?? 0,
      infoUrl: r.infoUrl ?? null,
      note: r.note ?? "",
      hostSkipVersion: r.hostSkipVersion ?? null,
    }));
  },
});
