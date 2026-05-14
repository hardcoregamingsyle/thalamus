/**
 * Hugging Face Space: GraphRAG + Chroma-backed RAG (same service used by team agents).
 * Override with HF_RAG_SPACE_URL or HF_RAG_BASE_URL in Convex env.
 */
export const DEFAULT_HF_RAG_SPACE_URL = "https://leadshello-graph-rag-and-chroma-db.hf.space";

export function getHfRagSpaceUrl(): string {
  const raw =
    process.env.HF_RAG_SPACE_URL?.trim() ||
    process.env.HF_RAG_BASE_URL?.trim() ||
    DEFAULT_HF_RAG_SPACE_URL;
  return raw.replace(/\/$/, "");
}

export async function hfAddDocument(id: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`${getHfRagSpaceUrl()}/add_document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function hfRunGraphRagIndex(): Promise<boolean> {
  try {
    const res = await fetch(`${getHfRagSpaceUrl()}/run_graphrag_index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Chroma-style vector retrieval over documents indexed in the Space. */
export async function hfQueryVector(query: string, nResults: number): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      query,
      n_results: String(Math.min(Math.max(nResults, 1), 24)),
    });
    const res = await fetch(`${getHfRagSpaceUrl()}/query_vector?${params.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { documents?: string[][] };
    return (data.documents?.[0] ?? []).filter(
      (d): d is string => typeof d === "string" && d.length > 0,
    );
  } catch {
    return [];
  }
}
