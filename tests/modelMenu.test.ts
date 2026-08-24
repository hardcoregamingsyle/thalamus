// Guards the curated Dispatcher model menu. It replaces the raw ModelScope
// /v1/models dump that previously let the Dispatcher pick weak or unservable
// models (and then fell through to the weak OpenRouter auto-router). The
// invariants that matter:
//   1. Every offered id resolves to a real provider catalog (so an assignment
//      actually short-circuits to that provider instead of silently no-oping).
//   2. Coder / Critic must never be steered toward a LIGHT seat — the menu
//      tiers encode that guidance.
//   3. The rendered menu carries the tier labels the Dispatcher prompt relies on.
import { describe, expect, test } from "bun:test";
import {
  buildDispatcherModelMenu,
  DISPATCHER_MODEL_MENU,
} from "../src/convex/lib/modelMenu";
import { ZEN_MODEL_CATALOG } from "../src/convex/lib/zenClient";
import { OPENROUTER_MODEL_CATALOG } from "../src/convex/lib/openrouterClient";
import { ORCAROUTER_MODEL_CATALOG } from "../src/convex/lib/orcaRouterClient";
import { DEADLYSIGNALS_MODEL_CATALOG } from "../src/convex/lib/deadlySignalsClient";
import { MODELSCOPE_MODEL_CATALOG } from "../src/convex/lib/modelscopeClient";
import { HUGGINGFACE_MODEL_CATALOG } from "../src/convex/lib/huggingFaceClient";
import { POLLINATIONS_MODEL_CATALOG } from "../src/convex/lib/pollinationsClient";

function allCatalogIds(): Set<string> {
  return new Set([
    ...ZEN_MODEL_CATALOG.map((m) => m.id),
    ...ORCAROUTER_MODEL_CATALOG.map((m) => m.id),
    ...OPENROUTER_MODEL_CATALOG.map((m) => m.id),
    ...DEADLYSIGNALS_MODEL_CATALOG.map((m) => m.id),
    ...MODELSCOPE_MODEL_CATALOG.map((m) => m.id),
    ...HUGGINGFACE_MODEL_CATALOG.map((m) => m.id),
    ...POLLINATIONS_MODEL_CATALOG.map((m) => m.id),
  ]);
}

describe("curated dispatcher model menu", () => {
  test("every offered id resolves to a real provider catalog", () => {
    const known = allCatalogIds();
    for (const tier of DISPATCHER_MODEL_MENU) {
      for (const id of tier.ids) {
        expect(known.has(id), `${id} must exist in a provider catalog`).toBe(true);
      }
    }
  });

  test("ids are unique across the whole menu", () => {
    const seen = new Set<string>();
    for (const tier of DISPATCHER_MODEL_MENU) {
      for (const id of tier.ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  test("has at least one FRONTIER and one STANDARD tier", () => {
    const labels = DISPATCHER_MODEL_MENU.map((t) => t.label);
    expect(labels).toContain("FRONTIER");
    expect(labels).toContain("STANDARD");
    expect(DISPATCHER_MODEL_MENU.find((t) => t.label === "FRONTIER")!.ids.length).toBeGreaterThan(0);
    expect(DISPATCHER_MODEL_MENU.find((t) => t.label === "STANDARD")!.ids.length).toBeGreaterThan(0);
  });

  test("rendered menu carries the tier labels and exact-id instruction", () => {
    const menu = buildDispatcherModelMenu();
    expect(menu).toContain("## Live model menu");
    expect(menu).toContain("[FRONTIER]");
    expect(menu).toContain("[STANDARD]");
    expect(menu).toContain("never invent one");
  });
});
