// Guards the ModelScope model blocklist — models this account is KNOWN to be
// unable to serve (e.g. Qwen3.8-Max 403s "your current account does not have
// access"). If a blocked model ever appears in the live /v1/models menu, the
// Dispatcher keeps assigning it and the whole provider chain falls through on
// a guaranteed 403 — the "random" provider-hopping the logs showed. findModelScopeModel
// is the single choke point for every assigned-model route, so a blocked id
// must never resolve there.
import { describe, expect, test } from "bun:test";
import { findModelScopeModel } from "../src/convex/lib/modelscopeClient";

describe("modelscope blocklist", () => {
  test("a blocked model never resolves to a servable seat", () => {
    // Qwen3.8-Max 403s on this account even though ModelScope lists it.
    expect(findModelScopeModel("Qwen-Ambassador/Qwen3.8-Max")).toBeUndefined();
    expect(findModelScopeModel("Qwen/Qwen3.8-Max")).toBeUndefined();
  });

  test("catalog models still resolve", () => {
    expect(findModelScopeModel("deepseek-ai/DeepSeek-V4-Pro")?.id).toBe("deepseek-ai/DeepSeek-V4-Pro");
    expect(findModelScopeModel("Qwen/Qwen3.5-397B-A17B")?.id).toBe("Qwen/Qwen3.5-397B-A17B");
  });
});
