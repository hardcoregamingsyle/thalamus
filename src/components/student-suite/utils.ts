// Chat-history-to-topic seeding used by the StudentSuite views (spaced review,
// interleaved practice, concept map, teach-back, mistake review). All views
// call getStudyTopics with the same chat history so their prompts stay
// consistent within one open session.

export function cleanStudyText(text: string) {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getStudyTopics(chatHistory: Array<{ role: string; content: string }>) {
  const userLines = chatHistory
    .filter(message => message.role === "user")
    .map(message => cleanStudyText(message.content))
    .filter(Boolean);

  const assistantLines = chatHistory
    .filter(message => message.role !== "user")
    .flatMap(message => cleanStudyText(message.content).split(/[.!?]/))
    .map(line => line.trim())
    .filter(line => line.length > 24);

  const seeds = [...userLines, ...assistantLines]
    .map(line => line.slice(0, 72))
    .filter((line, index, arr) => arr.findIndex(item => item.toLowerCase() === line.toLowerCase()) === index)
    .slice(0, 6);

  return seeds.length > 0 ? seeds : [
    "Main concept from your latest study chat",
    "Key definition or formula",
    "Common exam question",
    "A confusing step to practice again",
  ];
}
