"use node";
// Generates cryptographically random repo and branch names that are
// functionally undiscoverable by enumeration. Public repos are free;
// the random name is the only access control needed.

import crypto from "crypto";

export function generateObscureRepoName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const randomValues = crypto.randomBytes(251);

  let name = "repo-";
  for (const b of randomValues) {
    name += chars[b % chars.length];
  }
  return name; // 256 chars total, 251 random — 64^251 combinations
}

export function generateObscureBranchName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/";
  const randomValues = crypto.randomBytes(193);

  let name = "branch-";
  for (const b of randomValues) {
    name += chars[b % chars.length];
  }
  return name;
}
