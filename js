const allMessages: AgentMessage[] = [...agentMessages, ...userMessages].sort((a, b) =>
  (a.messageIndex ?? 0) - (b.messageIndex ?? 0)
);
