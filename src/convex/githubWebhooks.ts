import { httpAction, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

type GithubConfig = Doc<"githubConfigs">;

// Minimal shape of the GitHub push-webhook payload we actually read. Kept
// local rather than pulled from @octokit/webhooks-types to avoid dragging a
// large type surface into a file that only touches four fields.
type PushWebhookPayload = {
  repository?: { full_name?: string };
  ref?: string;
  commits?: unknown[];
};

// Webhook endpoint for GitHub push events
export const handlePushWebhook = httpAction(async (ctx, request) => {
  try {
    const event = request.headers.get("x-github-event");

    if (event !== "push") {
      return new Response(JSON.stringify({ message: "Event ignored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = await request.json() as PushWebhookPayload;
    const repoFullName = payload.repository?.full_name;
    const branch = payload.ref?.replace("refs/heads/", "");

    if (!repoFullName || !branch) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Find all branches connected to this repo
    const configs: GithubConfig[] = await ctx.runQuery(internal.githubSyncHelpers.findConfigsByRepo, {
      repoFullName,
      branch,
    });

    // Trigger pull for each connected branch
    for (const config of configs) {
      await ctx.scheduler.runAfter(0, internal.githubWebhooks.processPushInternal, {
        projectId: config.projectId,
        branchId: config.branchId,
        commits: payload.commits || [],
      });
    }

    return new Response(JSON.stringify({
      message: "Webhook received",
      branchesTriggered: configs.length,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// Internal action to process the push
export const processPushInternal = internalAction({
  args: {
    projectId: v.string(),
    branchId: v.string(),
    commits: v.array(v.any()),
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      // Pull latest changes from GitHub
      const config: GithubConfig | null = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      if (!config) return;

      // Import Octokit dynamically
      const { Octokit } = await import("@octokit/rest");
      const octokit = new Octokit({
        auth: config.githubToken || process.env.GITHUB_TOKEN,
      });

      const { data: tree } = await octokit.git.getTree({
        owner: config.owner,
        repo: config.repo,
        tree_sha: config.branch,
        recursive: "true",
      });

      // Update files in Convex
      for (const item of tree.tree) {
        if (item.type === "blob" && item.path && item.sha) {
          try {
            const { data: blob } = await octokit.git.getBlob({
              owner: config.owner,
              repo: config.repo,
              file_sha: item.sha,
            });

            const content = Buffer.from(blob.content, "base64").toString("utf-8");

            await ctx.runMutation(internal.codeBranches.upsertFile, {
              branchId: args.branchId,
              filepath: item.path,
              content,
              agent: "GitHub Webhook",
            });
          } catch (err) {
            console.error(`Failed to sync ${item.path}:`, err);
          }
        }
      }

      // Save commit info
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId: args.branchId,
        agent: "GitHub",
        content: `🔄 Synced ${args.commits.length} commit(s) from GitHub`,
      });

      await ctx.runMutation(internal.githubSyncHelpers.updateLastSync, {
        projectId: args.projectId,
        branchId: args.branchId,
      });
    } catch (err) {
      console.error("Process push error:", err);
    }
  },
});
