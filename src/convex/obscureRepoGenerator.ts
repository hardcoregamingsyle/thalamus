/**
 * Generate obscure GitHub repository names
 * These are public repos but with names so absurdly long and random
 * that the probability of discovery is effectively 0
 *
 * Saves money: Public repos are free, private repos cost $4/month
 */

export function generateObscureRepoName(): string {
  // 256 character random string = 2^(256*6) possible combinations
  // That's more than atoms in the observable universe
  // Probability of collision or discovery: ~0

  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const length = 256; // Maximum GitHub allows

  let obscureName = "repo-";

  // Use crypto-secure randomness
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < length - 5; i++) {
    obscureName += chars[randomValues[i] % chars.length];
  }

  return obscureName;
}

export function generateObscureBranchName(): string {
  // Branch names can be even longer
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/";
  const length = 200;

  let obscureName = "branch-";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < length - 7; i++) {
    obscureName += chars[randomValues[i] % chars.length];
  }

  return obscureName;
}

/**
 * Calculate the probability of someone finding this repo
 * Spoiler: It's effectively 0
 */
export function calculateDiscoveryProbability(): {
  possibleCombinations: string;
  probabilityOfDiscovery: string;
  comparison: string;
} {
  // 64 possible characters (a-z, A-Z, 0-9, -, _)
  // 251 character length (256 - "repo-")
  // Combinations = 64^251

  const bitsOfEntropy = 251 * 6; // log2(64) = 6
  const atomsInUniverse = 10e80;

  return {
    possibleCombinations: `64^251 ≈ 10^${Math.floor(251 * Math.log10(64))}`,
    probabilityOfDiscovery: `< 1 in 10^${Math.floor(251 * Math.log10(64))}`,
    comparison: `More combinations than atoms in ${Math.floor(10 ** (251 * Math.log10(64) - 80) / 1e80)} universes`,
  };
}

/**
 * Security analysis:
 * - 251 chars * 6 bits/char = 1506 bits of entropy
 * - 2^1506 possible combinations
 * - Even if someone tried 1 trillion guesses per second
 * - It would take 10^435 years to have 1% chance of finding it
 * - Universe age: 13.8 billion years (10^10)
 * - Effectively: IMPOSSIBLE to find by chance or brute force
 */
