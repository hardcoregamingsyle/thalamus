import { type QueryCtx } from "./_generated/server";
import { type Id } from "./_generated/dataModel";

// Shared authorization for the code-mode (codeProjects/codeBranches) system.
// Every write path that acts on a branch MUST go through one of these so a
// caller can only touch branches inside a project they own — otherwise any
// authenticated user can drive another user's build with a known branch id
// (branch ids are short random strings, not a security boundary).

/** Resolve a session token to its (unexpired) session row, or throw. */
export async function requireSession(ctx: QueryCtx, token: string) {
  const session = (
    await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .take(1)
  )[0];
  if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
  return session;
}

/** Load a project by its public id and assert `userId` owns it, or throw. */
export async function assertProjectOwner(ctx: QueryCtx, userId: Id<"users">, projectId: string) {
  const project = await ctx.db
    .query("codeProjects")
    .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
    .first();
  if (!project || project.userId !== userId) throw new Error("Not authorized");
  return project;
}

/** Load a branch + its project and assert `userId` owns the project, or throw. */
export async function assertBranchOwner(ctx: QueryCtx, userId: Id<"users">, branchId: string) {
  const branch = await ctx.db
    .query("codeBranches")
    .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
    .first();
  if (!branch) throw new Error("Branch not found");
  const project = await assertProjectOwner(ctx, userId, branch.projectId);
  return { branch, project };
}

/** Convenience: authenticate the token AND assert it owns the branch. */
export async function requireBranchOwner(ctx: QueryCtx, token: string, branchId: string) {
  const session = await requireSession(ctx, token);
  const { branch, project } = await assertBranchOwner(ctx, session.userId, branchId);
  return { session, branch, project };
}
