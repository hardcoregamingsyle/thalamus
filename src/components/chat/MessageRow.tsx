// Clean, modern message row for the portal chat (ChatGPT/Claude-style). User
// messages are right-aligned accent bubbles; assistant messages are full-width
// rows with a compact avatar chip, a timestamp, a copy button, and rendered
// content (code blocks get their own copy buttons). Memoized so per-chunk
// streaming updates don't re-render the whole history.

import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Sparkles } from "lucide-react";
import RichContent from "@/components/chat/RichContent";
import StudyQuestionHydrator from "@/components/chat/StudyQuestionHydrator";
import { formatMessageTime } from "@/lib/dateFormat";
import type { Message } from "@/pages/portal/types";

interface MessageRowProps {
  msg: Message;
  accentColor: string; // tailwind text color for the assistant avatar
  dayLabel?: string; // if set, render a "Today/Yesterday/date" divider above
  // When provided (study mode), assistant messages hydrate any ask/mcq
  // question markers into interactive in-chat widgets. onAnswer(question,
  // answer) is called when the student submits an answer.
  onStudyAnswer?: (question: string, answer: string) => void;
}

const MessageRow = memo(function MessageRow({ msg, accentColor, dayLabel, onStudyAnswer }: MessageRowProps) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";
  const time = formatMessageTime(msg.createdAt);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const divider = dayLabel ? (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border/60" />
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{dayLabel}</span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  ) : null;

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col"
      >
        {divider}
        <div className="flex justify-end">
          <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%]">
            <div className="rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5 text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap">
              {msg.content}
            </div>
            {time && <span className="mt-1 text-[10px] text-muted-foreground/70">{time}</span>}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex flex-col"
    >
      {divider}
      <div className="flex gap-3">
        <div className="shrink-0 w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center mt-0.5 shadow-sm">
          <Sparkles className={`h-4 w-4 ${accentColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 h-8 mb-0.5">
            <span className="text-xs font-medium text-muted-foreground">Thalamus</span>
            {time && <span className="text-[10px] text-muted-foreground/60">{time}</span>}
            <button
              onClick={copyText}
              aria-label="Copy response"
              className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="text-[15px] leading-relaxed text-foreground max-w-full">
            {onStudyAnswer ? (
              // Study content is MARKDOWN (not HTML) — pass it raw so
              // react-markdown formats it and the JSON-op extractor can parse
              // fenced ops. Substituting \n for <br/> here would corrupt both.
              <StudyQuestionHydrator
                html={msg.content}
                onAnswer={onStudyAnswer}
              />
            ) : (
              <RichContent
                html={msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>")}
              />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});

export default MessageRow;
