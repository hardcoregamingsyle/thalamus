// @ts-nocheck
"use node";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { hfAddDocument, hfRunGraphRagIndex, hfQueryVector } from "./hfRagSpace";

// ── Embedding generation using Gemini text-embedding-004 (keys from env) ───────
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

// ── Text chunking ─────────────────────────────────────────────────────────────
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

// ── Extract entities and relations using Claude/Gemini ────────────────────────
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
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

// ── Auto-RAG: Vectorize a study resource ─────────────────────────────────────
export const vectorizeResource = action({
  args: {
    token: v.string(),
    resourceId: v.id("studyResources"),
  },
  handler: async (ctx, args): Promise<{ chunksCreated: number; nodesCreated: number; edgesCreated: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    // Get the resource
    const resources = await ctx.runQuery(internal.studyHelpers.getResourcesForUser, { userId });
    const resource = resources.find((r: { _id: Id<"studyResources">; title: string; content: string }) => r._id === args.resourceId);
    if (!resource) throw new Error("Resource not found");

    // Delete existing chunks and graph for this resource
    await ctx.runMutation(internal.ragHelpers.deleteChunksForResource, { resourceId: args.resourceId });
    await ctx.runMutation(internal.ragHelpers.deleteGraphForResource, { resourceId: args.resourceId });

    const chunks = chunkText(resource.content);
    let chunksCreated = 0;

    for (let i = 0; i < Math.min(chunks.length, 50); i++) {
      try {
        const embedding = await generateEmbedding(chunks[i]);
        await ctx.runMutation(internal.ragHelpers.insertChunk, {
          userId,
          resourceId: args.resourceId,
          chunkIndex: i,
          text: chunks[i],
          embedding,
        });
        chunksCreated++;
      } catch {
        // Skip failed chunks
      }
    }

    // 2. Extract knowledge graph
    const { nodes, edges } = await extractKnowledgeGraph(resource.content, resource.title);
    const nodeIdMap = new Map<string, Id<"graphNodes">>();
    let nodesCreated = 0;
    let edgesCreated = 0;

    // Insert nodes with embeddings
    for (const node of nodes) {
      try {
        const embedding = await generateEmbedding(`${node.label}: ${node.description}`);
        const nodeId = await ctx.runMutation(internal.ragHelpers.insertGraphNode, {
          userId,
          resourceId: args.resourceId,
          label: node.label,
          type: node.type,
          description: node.description,
          embedding,
        });
        nodeIdMap.set(node.label.toLowerCase(), nodeId as Id<"graphNodes">);
        nodesCreated++;
      } catch {
        // Skip failed nodes
      }
    }

    // Insert edges
    for (const edge of edges) {
      const sourceId = nodeIdMap.get(edge.source.toLowerCase());
      const targetId = nodeIdMap.get(edge.target.toLowerCase());
      if (!sourceId || !targetId) continue;
      try {
        await ctx.runMutation(internal.ragHelpers.insertGraphEdge, {
          userId,
          resourceId: args.resourceId,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          relation: edge.relation,
          weight: 1.0,
        });
        edgesCreated++;
      } catch {
        // Skip failed edges
      }
    }

    // Mark resource as indexed
    await ctx.runMutation(internal.ragHelpers.markResourceRagIndexed, {
      resourceId: args.resourceId,
      graphIndexed: nodesCreated > 0,
    });

    // Hugging Face Space: Chroma + GraphRAG index (shared with team portal)
    try {
      const studyDocId = `study:${userId}:${args.resourceId}`;
      const docBody = `${resource.title}\n\n${resource.content.slice(0, 28000)}`;
      await hfAddDocument(studyDocId, docBody);
      await Promise.race([
        hfRunGraphRagIndex(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
      ]);
    } catch {
      /* HF Space cold or unreachable — non-fatal */
    }

    return { chunksCreated, nodesCreated, edgesCreated };
  },
});

// ── Internal: Vectorize resource (called from scheduler) ─────────────────────
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

    try {
      const studyDocId = `study:${args.userId}:${args.resourceId}`;
      const docBody = `${resource.title}\n\n${resource.content.slice(0, 28000)}`;
      await hfAddDocument(studyDocId, docBody);
      await Promise.race([
        hfRunGraphRagIndex(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
      ]);
    } catch {
      /* HF Space optional */
    }
  },
});

async function buildChunkRagContext(
  ctx: ActionCtx,
  userId: Id<"users">,
  queryEmbedding: number[],
  hfDocs: string[],
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

  const merged = dedupeSnippets([...hfDocs, ...convexTexts], 750);
  if (merged.length === 0) return "";

  let body = merged.map((t, i) => `[${i + 1}] ${t}`).join("\n\n");
  if (body.length > MAX_RAG_CONTEXT_CHARS) {
    body = body.slice(0, MAX_RAG_CONTEXT_CHARS) + "\n...[RAG context capped for token budget]";
  }
  const label =
    "## Relevant knowledge (Hugging Face Chroma / vector RAG + Convex per-user chunks)";
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

// ── Internal: Get study context (called from study.ts) ───────────────────────
export const getStudyContextInternal = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
  },
  handler: async (ctx, args): Promise<{ ragContext: string; graphContext: string; hasContext: boolean }> => {
    let ragContext = "";
    let graphContext = "";

    try {
      const [hfDocs, queryEmbedding] = await Promise.all([
        hfQueryVector(args.query, 6, { timeoutMs: 2800 }),
        generateEmbedding(args.query),
      ]);
      const [ragBlock, graphBlock] = await Promise.all([
        buildChunkRagContext(ctx, args.userId, queryEmbedding, hfDocs),
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

// ── Semantic Search: Find relevant chunks for a query ────────────────────────
export const semanticSearch = action({
  args: {
    token: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{ text: string; score: number; resourceId: string }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const queryEmbedding = await generateEmbedding(args.query);
    const limit = Math.min(args.limit ?? 8, 16);

    const results = await ctx.vectorSearch("ragChunks", "by_embedding", {
      vector: queryEmbedding,
      limit,
      filter: (q) => q.eq("userId", userId),
    });

    // Fetch the actual chunk texts
    const chunks = await Promise.all(
      results.map(async (r) => {
        const chunk = await ctx.runQuery(internal.ragHelpers.getChunkById, { chunkId: r._id as Id<"ragChunks"> });
        return chunk ? { text: chunk.text, score: r._score, resourceId: chunk.resourceId as string } : null;
      })
    );

    return chunks.filter((c): c is { text: string; score: number; resourceId: string } => c !== null);
  },
});

// ── Graph Semantic Search: Find relevant nodes ────────────────────────────────
export const graphSemanticSearch = action({
  args: {
    token: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{
    nodeId: string;
    label: string;
    type: string;
    description: string;
    score: number;
    neighbors: Array<{ label: string; relation: string; direction: "out" | "in" }>;
  }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const queryEmbedding = await generateEmbedding(args.query);
    const limit = Math.min(args.limit ?? 5, 10);

    const results = await ctx.vectorSearch("graphNodes", "by_embedding", {
      vector: queryEmbedding,
      limit,
      filter: (q) => q.eq("userId", userId),
    });

    const enriched = await Promise.all(
      results.map(async (r) => {
        const node = await ctx.runQuery(internal.ragHelpers.getNodeById, { nodeId: r._id as Id<"graphNodes"> });
        if (!node) return null;

        // Get neighbors
        const { outgoing, incoming } = await ctx.runQuery(internal.ragHelpers.getEdgesForNode, { nodeId: r._id as Id<"graphNodes"> });
        const neighbors: Array<{ label: string; relation: string; direction: "out" | "in" }> = [];

        for (const edge of outgoing.slice(0, 5)) {
          const target = await ctx.runQuery(internal.ragHelpers.getNodeById, { nodeId: edge.targetNodeId });
          if (target) neighbors.push({ label: target.label, relation: edge.relation, direction: "out" });
        }
        for (const edge of incoming.slice(0, 5)) {
          const source = await ctx.runQuery(internal.ragHelpers.getNodeById, { nodeId: edge.sourceNodeId });
          if (source) neighbors.push({ label: source.label, relation: edge.relation, direction: "in" });
        }

        return {
          nodeId: r._id as string,
          label: node.label,
          type: node.type,
          description: node.description,
          score: r._score,
          neighbors,
        };
      })
    );

    return enriched.filter((n): n is NonNullable<typeof n> => n !== null);
  },
});

// ── GraphRAG Health Check ─────────────────────────────────────────────────────
export const checkGraphHealth = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{
    status: "healthy" | "degraded" | "broken";
    totalNodes: number;
    totalEdges: number;
    orphanNodes: number;
    disconnectedComponents: number;
    issues: string[];
    recommendations: string[];
  }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const nodes = await ctx.runQuery(internal.ragHelpers.getGraphNodesForUser, { userId });
    const edges = await ctx.runQuery(internal.ragHelpers.getGraphEdgesForUser, { userId });

    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for orphan nodes (no edges)
    const nodeIdsWithEdges = new Set<string>();
    for (const edge of edges) {
      nodeIdsWithEdges.add(edge.sourceNodeId as string);
      nodeIdsWithEdges.add(edge.targetNodeId as string);
    }
    const orphanNodes = nodes.filter((n: any) => !nodeIdsWithEdges.has(n._id as string)).length;

    if (orphanNodes > 0) {
      issues.push(`${orphanNodes} orphan nodes with no connections`);
      recommendations.push("Re-index resources to rebuild graph connections");
    }

    // Check for disconnected components using union-find
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (x: string, y: string) => {
      parent.set(find(x), find(y));
    };

    for (const node of nodes) parent.set(node._id as string, node._id as string);
    for (const edge of edges) union(edge.sourceNodeId as string, edge.targetNodeId as string);

    const components = new Set(nodes.map((n: any) => find(n._id as string)));
    const disconnectedComponents = components.size;

    if (disconnectedComponents > 3 && nodes.length > 10) {
      issues.push(`${disconnectedComponents} disconnected graph components`);
      recommendations.push("Add more resources to bridge knowledge gaps");
    }

    // Check edge-to-node ratio
    const edgeRatio = nodes.length > 0 ? edges.length / nodes.length : 0;
    if (nodes.length > 5 && edgeRatio < 0.5) {
      issues.push("Low graph connectivity (few edges per node)");
      recommendations.push("Upload more detailed resources to improve graph density");
    }

    // Check total coverage
    const chunks = await ctx.runQuery(internal.ragHelpers.getChunksForUser, { userId });
    if (chunks.length === 0 && nodes.length === 0) {
      issues.push("No RAG index found — no resources have been vectorized");
      recommendations.push("Upload study materials and run vectorize; set GEMINI_API_KEY on Convex for embeddings.");
      recommendations.push("Study docs are also pushed to the Hugging Face RAG Space (HF_RAG_SPACE_URL) for Chroma + GraphRAG.");
    }

    // Determine status
    let status: "healthy" | "degraded" | "broken" = "healthy";
    if (issues.length === 0) {
      status = "healthy";
      if (nodes.length > 0) recommendations.push("Graph is healthy! Keep adding resources to expand knowledge.");
    } else if (issues.length <= 2 && orphanNodes < nodes.length * 0.3) {
      status = "degraded";
    } else {
      status = "broken";
    }

    // Save health check
    await ctx.runMutation(internal.ragHelpers.saveHealthCheck, {
      userId,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      orphanNodes,
      disconnectedComponents,
      status,
      issues,
      recommendations,
    });

    return { status, totalNodes: nodes.length, totalEdges: edges.length, orphanNodes, disconnectedComponents, issues, recommendations };
  },
});

// ── Combined RAG + GraphRAG context retrieval for study mode ──────────────────
export const getStudyContext = action({
  args: {
    token: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args): Promise<{
    ragContext: string;
    graphContext: string;
    hasContext: boolean;
  }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) return { ragContext: "", graphContext: "", hasContext: false };

    let ragContext = "";
    let graphContext = "";

    try {
      const [hfDocs, queryEmbedding] = await Promise.all([
        hfQueryVector(args.query, 6, { timeoutMs: 2800 }),
        generateEmbedding(args.query),
      ]);
      const [ragBlock, graphBlock] = await Promise.all([
        buildChunkRagContext(ctx, userId, queryEmbedding, hfDocs),
        buildGraphRagContextSection(ctx, userId, queryEmbedding),
      ]);
      ragContext = ragBlock;
      graphContext = graphBlock;
    } catch {
      // RAG/Graph search failed — continue without context
    }

    return {
      ragContext,
      graphContext,
      hasContext: ragContext.length > 0 || graphContext.length > 0,
    };
  },
});