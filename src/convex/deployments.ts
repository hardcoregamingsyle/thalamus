/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Deploy to Vercel
export const deployToVercel = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    vercelToken: v.string(),
    projectName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      // Get all files
      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      // Create Vercel deployment
      const deploymentData = {
        name: args.projectName || `thalamus-${args.branchId.toLowerCase()}`,
        files: files.map(f => ({
          file: f.filepath,
          data: f.content,
        })),
        projectSettings: {
          framework: "vite",
          buildCommand: "npm run build",
          outputDirectory: "dist",
        },
      };

      const response = await fetch("https://api.vercel.com/v13/deployments", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${args.vercelToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(deploymentData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Vercel deployment failed");
      }

      const result = await response.json();

      return {
        success: true,
        url: result.url || `https://${result.name}.vercel.app`,
        deploymentId: result.id,
        platform: "vercel",
      };
    } catch (err) {
      console.error("Vercel deployment error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to deploy to Vercel");
    }
  },
});

// Deploy to Netlify
export const deployToNetlify = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    netlifyToken: v.string(),
    siteName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      // Create Netlify site if needed
      let siteId: string;
      if (!args.siteName) {
        const siteResponse = await fetch("https://api.netlify.com/api/v1/sites", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${args.netlifyToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: `thalamus-${args.branchId.toLowerCase()}`,
          }),
        });

        if (!siteResponse.ok) {
          throw new Error("Failed to create Netlify site");
        }

        const site = await siteResponse.json();
        siteId = site.id;
      } else {
        siteId = args.siteName;
      }

      // Prepare files for Netlify (create zip or direct upload)
      const filesMap: Record<string, string> = {};
      files.forEach(f => {
        filesMap[f.filepath] = f.content;
      });

      // Deploy to Netlify
      const deployResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${args.netlifyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          files: filesMap,
        }),
      });

      if (!deployResponse.ok) {
        const error = await deployResponse.json();
        throw new Error(error.message || "Netlify deployment failed");
      }

      const deployment = await deployResponse.json();

      return {
        success: true,
        url: deployment.url || deployment.ssl_url,
        deploymentId: deployment.id,
        platform: "netlify",
      };
    } catch (err) {
      console.error("Netlify deployment error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to deploy to Netlify");
    }
  },
});

// Deploy to Cloudflare Pages
export const deployToCloudflare = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    cloudflareToken: v.string(),
    accountId: v.string(),
    projectName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      const cfProjectName = args.projectName || `thalamus-${args.branchId.toLowerCase()}`;

      // Create Cloudflare Pages project if doesn't exist
      const projectResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/pages/projects/${cfProjectName}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${args.cloudflareToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!projectResponse.ok && projectResponse.status === 404) {
        // Create project
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/pages/projects`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${args.cloudflareToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: cfProjectName,
              production_branch: "main",
            }),
          }
        );
      }

      // Create deployment
      const formData = new FormData();
      files.forEach(f => {
        formData.append(f.filepath, new Blob([f.content], { type: "text/plain" }));
      });

      const deployResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/pages/projects/${cfProjectName}/deployments`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${args.cloudflareToken}`,
          },
          body: formData,
        }
      );

      if (!deployResponse.ok) {
        const error = await deployResponse.json();
        throw new Error(error.errors?.[0]?.message || "Cloudflare deployment failed");
      }

      const deployment = await deployResponse.json();

      return {
        success: true,
        url: deployment.result?.url || `https://${cfProjectName}.pages.dev`,
        deploymentId: deployment.result?.id,
        platform: "cloudflare",
      };
    } catch (err) {
      console.error("Cloudflare deployment error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to deploy to Cloudflare");
    }
  },
});

// Generate deployment config files
export const generateDeployConfig = action({
  args: {
    token: v.string(),
    branchId: v.string(),
    platform: v.union(v.literal("vercel"), v.literal("netlify"), v.literal("cloudflare")),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const configs: Record<string, string> = {};

    switch (args.platform) {
      case "vercel":
        configs["vercel.json"] = JSON.stringify({
          buildCommand: "npm run build",
          outputDirectory: "dist",
          framework: "vite",
          rewrites: [
            { source: "/(.*)", destination: "/index.html" }
          ]
        }, null, 2);
        break;

      case "netlify":
        configs["netlify.toml"] = `[build]
  publish = "dist"
  command = "npm run build"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200`;
        break;

      case "cloudflare":
        configs["wrangler.toml"] = `name = "thalamus-app"
compatibility_date = "2024-01-01"

[site]
bucket = "./dist"`;
        break;
    }

    // Save config files to branch
    for (const [filepath, content] of Object.entries(configs)) {
      await ctx.runMutation(internal.codeBranches.upsertFile, {
        branchId: args.branchId,
        filepath,
        content,
        agent: "AI Deployment Config",
      });
    }

    return {
      success: true,
      filesCreated: Object.keys(configs),
    };
  },
});
