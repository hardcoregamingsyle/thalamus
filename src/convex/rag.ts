/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Embedding generation using Gemini text-embedding-004 (keys from env)
let embKeyIdx = 0;

function getGeminiApiKeys(): string[] {
  const raw = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? "";
  const keys = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return keys;
}

const MAX_RAG_CONTEXT_CHARS = 6000;
const MAX_GRAPH_CONTEXT_CHARS = 4000;

function dedupeSnippets(texts: string[], maxEach = 720): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const norm = t.slice(0, 140).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(norm)) continue;
    seen.add(norm);
    const clipped = t.length > maxEach ? t.slice(0, maxEach) + "\n...[trimmed]" : t;
    out.push(clipped);
    if (out.length >= 10) break;
  }
  return out;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error("Set GEMINI_API_KEY (or GOOGLE_AI_API_KEY) in Convex env for embeddings / RAG.");
  }
  const truncated = text.slice(0, 8000); // Gemini embedding limit
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[embKeyIdx % keys.length];
    embKeyIdx++;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/text-embedding-004",
            content: { parts: [{ text: truncated }] },
            outputDimensionality: 1536,
          }),
        }
      );
      if (!response.ok) {
        if (response.status === 429 || response.status === 403) continue;
        throw new Error(`Embedding API error ${response.status}`);
      }
      const data = await response.json() as { embedding?: { values?: number[] } };
      const values = data.embedding?.values;
      if (!values || values.length === 0) throw new Error("Empty embedding");
      // Pad or truncate to exactly 1536 dimensions
      if (values.length < 1536) {
        return [...values, ...new Array(1536 - values.length).fill(0)];
      }
      return values.slice(0, 1536);
    } catch (err) {
      if (attempt === keys.length - 1) throw err;
    }
  }
  throw new Error("All Gemini embedding keys failed");
}

// Text chunking
function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start += chunkSize - overlap;
  }
  return chunks;
}

// Extract entities and relations using Claude/Gemini
async function extractKnowledgeGraph(text: string, title: string): Promise<{
  nodes: Array<{ label: string; type: string; description: string }>;
  edges: Array<{ source: string; target: string; relation: string }>;
}> {
  const prompt = `Extract a knowledge graph from this text. Return ONLY valid JSON.

TEXT TITLE: ${title}
TEXT: ${text.slice(0, 4000)}

Return JSON in this exact format:
{
  "nodes": [
    {"label": "entity name", "type": "concept|person|place|event|formula|definition", "description": "brief description"}
  ],
  "edges": [
    {"source": "entity1 label", "target": "entity2 label", "relation": "relationship type"}
  ]
}

Rules:
- Extract 5-20 key entities (nodes)
- Extract 5-30 relationships (edges)
- Only include edges where both source and target are in nodes
- Relation types: causes, defines, is_part_of, leads_to, contrasts_with, supports, requires, produces, equals, describes
- Keep descriptions under 100 chars`;

  try {
    const keys = getGeminiApiKeys();
    if (keys.length === 0) return { nodes: [], edges: [] };
    const key = keys[Math.floor(Math.random() * keys.length)];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      }
    );
    if (!response.ok) throw new Error(`Gemini error ${response.status}`);
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const parsed = JSON.parse(jsonMatch[0]) as {
      nodes?: Array<{ label: string; type: string; description: string }>;
      edges?: Array<{ source: string; target: string; relation: string }>;
    };
    return {
      nodes: (parsed.nodes ?? []).slice(0, 30),
      edges: (parsed.edges ?? []).slice(0, 60),
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

// Internal: Vectorize resource (called from scheduler)
export const vectorizeResourceInternal = internalAction({
  args: {
    userId: v.id("users"),
    resourceId: v.id("studyResources"),
  },
  handler: async (ctx, args): Promise<void> => {
    const resources = await ctx.runQuery(internal.studyHelpers.getResourcesForUser, { userId: args.userId });
    const resource = resources.find((r: { _id: Id<"studyResources">; title: string; content: string }) => r._id === args.resourceId);
    if (!resource) return;

    await ctx.runMutation(internal.ragHelpers.deleteChunksForResource, { resourceId: args.resourceId });
    await ctx.runMutation(internal.ragHelpers.deleteGraphForResource, { resourceId: args.resourceId });

    const chunks = chunkText(resource.content);
    for (let i = 0; i < Math.min(chunks.length, 50); i++) {
      try {
        const embedding = await generateEmbedding(chunks[i]);
        await ctx.runMutation(internal.ragHelpers.insertChunk, {
          userId: args.userId,
          resourceId: args.resourceId,
          chunkIndex: i,
          text: chunks[i],
          embedding,
        });
      } catch { /* skip */ }
    }

    const { nodes, edges } = await extractKnowledgeGraph(resource.content, resource.title);
    const nodeIdMap = new Map<string, Id<"graphNodes">>();

    for (const node of nodes) {
      try {
        const embedding = await generateEmbedding(`${node.label}: ${node.description}`);
        const nodeId = await ctx.runMutation(internal.ragHelpers.insertGraphNode, {
          userId: args.userId,
          resourceId: args.resourceId,
          label: node.label,
          type: node.type,
          description: node.description,
          embedding,
        });
        nodeIdMap.set(node.label.toLowerCase(), nodeId as Id<"graphNodes">);
      } catch { /* skip */ }
    }

    for (const edge of edges) {
      const sourceId = nodeIdMap.get(edge.source.toLowerCase());
      const targetId = nodeIdMap.get(edge.target.toLowerCase());
      if (!sourceId || !targetId) continue;
      try {
        await ctx.runMutation(internal.ragHelpers.insertGraphEdge, {
          userId: args.userId,
          resourceId: args.resourceId,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          relation: edge.relation,
          weight: 1.0,
        });
      } catch { /* skip */ }
    }

    await ctx.runMutation(internal.ragHelpers.markResourceRagIndexed, {
      resourceId: args.resourceId,
      graphIndexed: nodeIdMap.size > 0,
    });

  },
});

async function buildChunkRagContext(
  ctx: ActionCtx,
  userId: Id<"users">,
  queryEmbedding: number[],
): Promise<string> {
  const chunkResults = await ctx.vectorSearch("ragChunks", "by_embedding", {
    vector: queryEmbedding,
    limit: 8,
    filter: (q) => q.eq("userId", userId),
  });

  const convexTexts: string[] = [];
  for (const r of chunkResults) {
    const chunk = await ctx.runQuery(internal.ragHelpers.getChunkById, { chunkId: r._id as Id<"ragChunks"> });
    if (chunk?.text) convexTexts.push(chunk.text);
  }

  const merged = dedupeSnippets(convexTexts, 750);
  if (merged.length === 0) return "";

  let body = merged.map((t, i) => `[${i + 1}] ${t}`).join("\n\n");
  if (body.length > MAX_RAG_CONTEXT_CHARS) {
    body = body.slice(0, MAX_RAG_CONTEXT_CHARS) + "\n...[RAG context capped for token budget]";
  }
  const label =
    "## Relevant knowledge (from this student's own uploaded material)";
  return `${label}\n${body}`;
}

async function buildGraphRagContextSection(
  ctx: ActionCtx,
  userId: Id<"users">,
  queryEmbedding: number[],
): Promise<string> {
  const nodeResults = await ctx.vectorSearch("graphNodes", "by_embedding", {
    vector: queryEmbedding,
    limit: 5,
    filter: (q) => q.eq("userId", userId),
  });

  if (nodeResults.length === 0) return "";

  const graphParts: string[] = [];
  for (const r of nodeResults) {
    const node = await ctx.runQuery(internal.ragHelpers.getNodeById, { nodeId: r._id as Id<"graphNodes"> });
    if (!node) continue;
    const { outgoing, incoming } = await ctx.runQuery(internal.ragHelpers.getEdgesForNode, { nodeId: r._id as Id<"graphNodes"> });
    const connections: string[] = [];
    for (const edge of outgoing.slice(0, 3)) {
      const target = await ctx.runQuery(internal.ragHelpers.getNodeById, { nodeId: edge.targetNodeId });
      if (target) connections.push(`→ ${target.label} (${edge.relation})`);
    }
    for (const edge of incoming.slice(0, 3)) {
      const source = await ctx.runQuery(internal.ragHelpers.getNodeById, { nodeId: edge.sourceNodeId });
      if (source) connections.push(`← ${source.label} (${edge.relation})`);
    }
    graphParts.push(
      `**${node.label}** [${node.type}]: ${node.description}${connections.length > 0 ? "\n  " + connections.join(", ") : ""}`,
    );
  }

  if (graphParts.length === 0) return "";
  let graphContext = "## Knowledge graph (GraphRAG — entities + relations)\n" + graphParts.join("\n\n");
  if (graphContext.length > MAX_GRAPH_CONTEXT_CHARS) {
    graphContext = graphContext.slice(0, MAX_GRAPH_CONTEXT_CHARS) + "\n...[graph context capped]";
  }
  return graphContext;
}

// Internal: Get study context (called from study.ts)
export const getStudyContextInternal = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
  },
  handler: async (ctx, args): Promise<{ ragContext: string; graphContext: string; hasContext: boolean }> => {
    let ragContext = "";
    let graphContext = "";

    try {
      const queryEmbedding = await generateEmbedding(args.query);
      const [ragBlock, graphBlock] = await Promise.all([
        buildChunkRagContext(ctx, args.userId, queryEmbedding),
        buildGraphRagContextSection(ctx, args.userId, queryEmbedding),
      ]);
      ragContext = ragBlock;
      graphContext = graphBlock;
    } catch {
      /* RAG unavailable — e.g. missing GEMINI_API_KEY */
    }

    return { ragContext, graphContext, hasContext: ragContext.length > 0 || graphContext.length > 0 };
  },
});

