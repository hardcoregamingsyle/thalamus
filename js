setIsThinking(false);
setStreamingContent("");
// ... fetch stream ...
// At the end:
setIsThinking(false);
setStreamingContent(null);  // ← This clears content IMMEDIATELY after stream ends!
