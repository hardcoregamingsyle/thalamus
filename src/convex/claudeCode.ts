// Claude Code integration with proper tool use
// Uses Anthropic API with computer use + bash + file edit tools

import { ClaudeModel, CLAUDE_PRICING } from "./agentCore";

export interface ClaudeCodeTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Define tools for Claude Code
const FILE_TOOLS: ClaudeCodeTool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file at the specified path. Returns the file content as a string.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file at the specified path. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        content: { type: "string", description: "Complete content to write to the file" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "edit_file",
    description: "Edit an existing file by replacing specific content. Use this for surgical edits to existing files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit" },
        old_str: { type: "string", description: "Exact string to find and replace" },
        new_str: { type: "string", description: "New string to replace with" }
      },
      required: ["path", "old_str", "new_str"]
    }
  },
  {
    name: "list_files",
    description: "List all files in the project. Returns a tree structure of all files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list (optional, defaults to project root)" }
      }
    }
  },
  {
    name: "search_files",
    description: "Search for a pattern across all files in the project. Returns matching files and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern or plain text to search for" },
        file_pattern: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts', 'src/**/*.tsx')" }
      },
      required: ["pattern"]
    }
  }
];

const BASH_TOOL: ClaudeCodeTool = {
  name: "bash",
  description: "Execute a bash command in the project directory. Returns stdout, stderr, and exit code.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command to execute" },
      timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" }
    },
    required: ["command"]
  }
};

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface ClaudeCodeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ClaudeCodeResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface FileOperation {
  type: "read" | "write" | "edit" | "list" | "search";
  path?: string;
  content?: string;
  old_str?: string;
  new_str?: string;
  pattern?: string;
  file_pattern?: string;
  result?: string;
}

export interface BashOperation {
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ClaudeCodeSession {
  messages: ClaudeCodeMessage[];
  fileOps: FileOperation[];
  bashOps: BashOperation[];
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Call Claude Code with tool use support
 * This implements the agentic loop: LLM → tool use → LLM → tool use → ... → final answer
 */
export async function callClaudeCode(
  task: string,
  systemPrompt: string,
  model: ClaudeModel,
  existingFiles: Array<{ filepath: string; content: string }>,
  maxTurns: number = 10,
  dbCreds?: { accessKeyId: string; secretAccessKey: string; region: string } | null,
): Promise<{
  finalText: string;
  fileOps: FileOperation[];
  bashOps: BashOperation[];
  inputTokens: number;
  outputTokens: number;
  turns: number;
}> {
  const session: ClaudeCodeSession = {
    messages: [],
    fileOps: [],
    bashOps: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  // Build initial context with existing files
  let contextMessage = `# Task\n\n${task}\n\n# Current Project Files\n\n`;
  if (existingFiles.length > 0) {
    contextMessage += existingFiles.map(f => `## ${f.filepath}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
  } else {
    contextMessage += "(No files yet - you can create them)";
  }

  session.messages.push({
    role: "user",
    content: contextMessage
  });

  let turns = 0;
  let finalText = "";

  while (turns < maxTurns) {
    turns++;

    // Call Claude API
    const response = await callClaudeAPI(
      session.messages,
      systemPrompt,
      model,
      [...FILE_TOOLS, BASH_TOOL],
      dbCreds
    );

    session.totalInputTokens += response.usage.input_tokens;
    session.totalOutputTokens += response.usage.output_tokens;

    // Extract text and tool uses
    const textBlocks = response.content.filter((b): b is TextBlock => b.type === "text");
    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    // Accumulate final text
    if (textBlocks.length > 0) {
      finalText = textBlocks.map(b => b.text).join("\n");
    }

    // Add assistant message to history
    session.messages.push({
      role: "assistant",
      content: response.content
    });

    // If no tool uses, we're done
    if (toolUses.length === 0 || response.stop_reason === "end_turn") {
      break;
    }

    // Execute tool uses and collect results
    const toolResults: ContentBlock[] = [];

    for (const toolUse of toolUses) {
      const result = await executeToolUse(toolUse, existingFiles, session);
      toolResults.push({
        type: "tool_result" as "text", // We'll format as text for simplicity
        text: JSON.stringify(result),
      } as TextBlock);
    }

    // Add tool results as next user message
    session.messages.push({
      role: "user",
      content: toolResults
    });
  }

  return {
    finalText,
    fileOps: session.fileOps,
    bashOps: session.bashOps,
    inputTokens: session.totalInputTokens,
    outputTokens: session.totalOutputTokens,
    turns,
  };
}

/**
 * Execute a tool use and return the result
 */
async function executeToolUse(
  toolUse: ToolUseBlock,
  existingFiles: Array<{ filepath: string; content: string }>,
  session: ClaudeCodeSession
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    switch (toolUse.name) {
      case "read_file": {
        const path = toolUse.input.path as string;
        const file = existingFiles.find(f => f.filepath === path);
        if (!file) {
          return { success: false, error: `File not found: ${path}` };
        }
        session.fileOps.push({
          type: "read",
          path,
          result: file.content
        });
        return { success: true, result: file.content };
      }

      case "write_file": {
        const path = toolUse.input.path as string;
        const content = toolUse.input.content as string;
        session.fileOps.push({
          type: "write",
          path,
          content
        });
        return { success: true, result: `File written: ${path}` };
      }

      case "edit_file": {
        const path = toolUse.input.path as string;
        const old_str = toolUse.input.old_str as string;
        const new_str = toolUse.input.new_str as string;
        session.fileOps.push({
          type: "edit",
          path,
          old_str,
          new_str
        });
        return { success: true, result: `File edited: ${path}` };
      }

      case "list_files": {
        const fileList = existingFiles.map(f => f.filepath).join("\n");
        session.fileOps.push({
          type: "list",
          result: fileList
        });
        return { success: true, result: fileList };
      }

      case "search_files": {
        const pattern = toolUse.input.pattern as string;
        const file_pattern = toolUse.input.file_pattern as string | undefined;
        const regex = new RegExp(pattern, "gi");
        const matches: string[] = [];

        for (const file of existingFiles) {
          if (file_pattern && !file.filepath.match(file_pattern)) continue;
          const lines = file.content.split("\n");
          lines.forEach((line, idx) => {
            if (regex.test(line)) {
              matches.push(`${file.filepath}:${idx + 1}: ${line.trim()}`);
            }
          });
        }

        const result = matches.length > 0 ? matches.join("\n") : "No matches found";
        session.fileOps.push({
          type: "search",
          pattern,
          file_pattern,
          result
        });
        return { success: true, result };
      }

      case "bash": {
        const command = toolUse.input.command as string;
        // For now, we don't actually execute bash in Convex
        // We just record the intent
        session.bashOps.push({
          command,
          stdout: "[Bash execution simulated - command recorded]",
          exitCode: 0
        });
        return { success: true, result: "Command recorded (execution simulated in serverless environment)" };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolUse.name}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Call Claude API via AWS Bedrock with tool support
 */
async function callClaudeAPI(
  messages: ClaudeCodeMessage[],
  systemPrompt: string,
  model: ClaudeModel,
  tools: ClaudeCodeTool[],
  dbCreds?: { accessKeyId: string; secretAccessKey: string; region: string } | null,
): Promise<ClaudeCodeResponse> {
  // TODO: Implement actual Bedrock API call with tool support
  // For now, return a mock response

  // This will be replaced with actual Bedrock InvokeModel call
  // that includes the tools array in the request body

  throw new Error("Claude Code API integration pending - Bedrock tool use not yet implemented");
}
