"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// ── Embedding generation using Gemini text-embedding-004 ─────────────────────
const GEMINI_KEYS = [
  "AIzaSyB6LdCRxGz27Xpj-K8-EiOVBQRvl0SPzyQ",
  "AIzaSyBZHdEWGlYTpr26fVGGWBOHxn4dRKkd-9Y",
  "AIzaSyCJHWZmUwc2_HAV-KS0Q4C50aOBkvm7OwE",
  "AIzaSyCOX7-EwKrZDVh6qUeGoqT_G-D3svl6tco",
  "AIzaSyCyRPBb-rFOZD_6aKgX6cQiKOshjlXt1ho",
];

let embKeyIdx = 0;

async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000); // Gemini embedding limit
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const key = GEMINI_KEYS[embKeyIdx % GEMINI_KEYS.length];
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
      if (attempt === GEMINI_KEYS.length - 1) throw err;
    }
  }
  throw new Error("All embedding keys exhausted");
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
    const key = GEMINI_KEYS[Math.floor(Math.random() * GEMINI_KEYS.length)];
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

    // 1. Chunk the text and generate embeddings
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
  },
});

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
      const queryEmbedding = await generateEmbedding(args.query);

      const chunkResults = await ctx.vectorSearch("ragChunks", "by_embedding", {
        vector: queryEmbedding,
        limit: 6,
        filter: (q) => q.eq("userId", args.userId),
      });

      if (chunkResults.length > 0) {
        const chunkTexts = await Promise.all(
          chunkResults.map(r => ctx.runQuery(internal.ragHelpers.getChunkById, { chunkId: r._id as Id<"ragChunks"> }))
        );
        const validChunks = chunkTexts.filter(Boolean);
        if (validChunks.length > 0) {
          ragContext = "## Relevant Knowledge (Semantic Search)\n" +
            validChunks.map((c, i) => `[${i + 1}] ${c!.text}`).join("\n\n");
        }
      }

      const nodeResults = await ctx.vectorSearch("graphNodes", "by_embedding", {
        vector: queryEmbedding,
        limit: 4,
        filter: (q) => q.eq("userId", args.userId),
      });

      if (nodeResults.length > 0) {
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
          graphParts.push(`**${node.label}** [${node.type}]: ${node.description}${connections.length > 0 ? "\n  " + connections.join(", ") : ""}`);
        }
        if (graphParts.length > 0) {
          graphContext = "## Knowledge Graph Context\n" + graphParts.join("\n\n");
        }
      }
    } catch { /* RAG unavailable */ }

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
    const orphanNodes = nodes.filter(n => !nodeIdsWithEdges.has(n._id as string)).length;

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

    const components = new Set(nodes.map(n => find(n._id as string)));
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
      recommendations.push("Upload study resources to enable semantic search");
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
      // Vector search for relevant chunks
      const queryEmbedding = await generateEmbedding(args.query);

      const chunkResults = await ctx.vectorSearch("ragChunks", "by_embedding", {
        vector: queryEmbedding,
        limit: 6,
        filter: (q) => q.eq("userId", userId),
      });

      if (chunkResults.length > 0) {
        const chunkTexts = await Promise.all(
          chunkResults.map(r => ctx.runQuery(internal.ragHelpers.getChunkById, { chunkId: r._id as Id<"ragChunks"> }))
        );
        const validChunks = chunkTexts.filter(Boolean);
        if (validChunks.length > 0) {
          ragContext = "## Relevant Knowledge (Semantic Search)\n" +
            validChunks.map((c, i) => `[${i + 1}] ${c!.text}`).join("\n\n");
        }
      }

      // Graph search for related concepts
      const nodeResults = await ctx.vectorSearch("graphNodes", "by_embedding", {
        vector: queryEmbedding,
        limit: 4,
        filter: (q) => q.eq("userId", userId),
      });

      if (nodeResults.length > 0) {
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
          graphParts.push(`**${node.label}** [${node.type}]: ${node.description}${connections.length > 0 ? "\n  " + connections.join(", ") : ""}`);
        }
        if (graphParts.length > 0) {
          graphContext = "## Knowledge Graph Context\n" + graphParts.join("\n\n");
        }
      }
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