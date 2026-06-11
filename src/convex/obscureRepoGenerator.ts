// Generates cryptographically random repo and branch names that are
// functionally undiscoverable by enumeration. Public repos are free;
// the random name is the only access control needed.

export function generateObscureRepoName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const randomValues = new Uint8Array(251);
  crypto.getRandomValues(randomValues);

  let name = "repo-";
  for (const b of randomValues) {
    name += chars[b % chars.length];
  }
  return name; // 256 chars total, 251 random — 64^251 combinations
}

export function generateObscureBranchName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/";
  const randomValues = new Uint8Array(193);
  crypto.getRandomValues(randomValues);

  let name = "branch-";
  for (const b of randomValues) {
    name += chars[b % chars.length];
  }
  return name;
}
