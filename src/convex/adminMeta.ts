import { query } from "./_generated/server";
import { v } from "convex/values";

// Everything on this page that names a provider, a model, or how requests are
// routed between them lives HERE, behind the admin token — not in Admin.tsx.
//
// Why: Admin.tsx is a lazy-loaded route, so Vite emits it as its own chunk at
// a public, permanently-cacheable /assets/Admin-<hash>.js. The password screen
// is a render-time gate; it does not stop anyone from fetching that file and
// reading it. Hardcoding the provider stack there published our primary
// provider, our fallback order, the model roster and our per-token cost basis
// to anyone who thought to look.
//
// The bundle now ships neutral slugs (providerA/B/C) and asks the server for
// the real labels once an admin has authenticated.

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

export const getAdminUiMeta = query({
  args: { adminToken: v.string() },
  handler: async (_ctx, args) => {
    if (!ADMIN_TOKEN || args.adminToken !== ADMIN_TOKEN) return null;

    return {
      providers: {
        providerA: {
          tabLabel: "NVIDIA NIM",
          title: "NVIDIA NIM API Keys",
          subtitle: "Primary provider — free models via build.nvidia.com. Keys stored in DB.",
          emptyWarning: "No keys — NIM unavailable, Ollama takes over",
          readyLabel: "keys — NIM primary active",
          help: [
            "Get free keys at build.nvidia.com → API Keys",
            "25+ free models: Nemotron, Llama, DeepSeek, Qwen, Kimi, Mistral, Phi-4",
            "NIM is PRIMARY — every request tries NIM first, only falls back to Ollama if NIM fails",
          ],
        },
        providerB: {
          tabLabel: "Ollama Cloud",
          title: "Ollama Cloud API Keys",
          subtitle: "Fallback provider. Keys stored in DB.",
          emptyWarning: "No keys — no fallback if the primary fails",
          readyLabel: "keys — Ollama backup ready",
          help: [
            "Get keys at ollama.com → Account → API Keys",
            "Ollama is the backup — only called when NIM fails or is unconfigured",
          ],
        },
        providerC: {
          tabLabel: "Modal",
          title: "Modal Endpoints",
          subtitle: "OpenAI-compatible endpoints served from Modal. The starred one is tried first; the rest act as backups in order. Register a self-hosted serverless model here and it goes live without a deploy.",
          namePlaceholder: "vLLM Qwen A100",
          modelPlaceholder: "Qwen/Qwen3-Coder-30B",
          emptyHint: "No endpoints yet. Requests fall through to NVIDIA NIM, then Ollama Cloud.",
          help: [],
        },
        providerD: {
          tabLabel: "AWS Bedrock",
          title: "AWS Bedrock Credentials",
          subtitle: "IAM credentials used for Claude Bedrock API calls (streaming chat, study mode, code mode)",
          emptyWarning: "No credentials set — Bedrock calls will fail",
          regionHint: "Credentials are stored server-side only. Select the region where your Bedrock model access is enabled.",
          iamPolicy: `{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream"
  ],
  "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude*"
}`,
          help: [],
        },
        providerE: {
          tabLabel: "Gemini Keys",
          title: "Gemini API Keys",
          subtitle: "Used for embeddings and as a fallback on the legacy chat paths.",
          emptyWarning: "No keys set — Gemini fallback will fail",
          keyPrefix: "AIza",
          keyPlaceholder: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\nAIzaSyYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
          help: [],
        },
      },
      // $ per million tokens. Also kept off the client — this is our cost basis.
      platformPricing: [
        { modelId: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", input: 0.60, output: 2.40 },
        { modelId: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", input: 1.80, output: 7.20 },
        { modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", input: 5.40, output: 26.50 },
        { modelId: "claude-opus-4-6", displayName: "Claude Opus 4.6", input: 7.44, output: 42.00 },
        { modelId: "claude-opus-4-8", displayName: "Claude Opus 4.8", input: 12.00, output: 60.00 },
      ],
    };
  },
});
