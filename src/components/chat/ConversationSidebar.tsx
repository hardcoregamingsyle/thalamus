// Collapsible conversation sidebar for the portal chat. Lists the current
// mode's sessions with delete, a "New chat" button, and the app/mode footer.
// Clean, minimal — the conversations are secondary to the composer.

import { motion } from "framer-motion";
import { MessageSquare, Plus, Trash2, X } from "lucide-react";
import type { Conversation } from "@/pages/portal/types";
import type { ModeMeta } from "@/pages/portal/modes";

interface ConversationSidebarProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConvId: string | null;
  onSelect: (c: Conversation) => void;
  onNew: () => void;
  onDelete: (c: Conversation) => void;
  mode: ModeMeta;
  userName?: string;
}

export default function ConversationSidebar({
  open,
  onClose,
  conversations,
  activeConvId,
  onSelect,
  onNew,
  onDelete,
  mode,
  userName,
}: ConversationSidebarProps) {
  if (!open) return null;

  return (
    <motion.aside
      initial={{ x: -260 }}
      animate={{ x: 0 }}
      exit={{ x: -260 }}
      transition={{ type: "tween", duration: 0.2 }}
      className="fixed md:relative inset-y-0 left-0 z-40 w-[260px] shrink-0 border-r border-border bg-card/60 backdrop-blur flex flex-col"
    >
      <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground truncate">Thalamus</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            aria-label="New conversation"
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-2 py-3 shrink-0">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 transition-colors px-3 py-2 text-sm text-foreground"
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
          New {mode.label.charAt(0) + mode.label.slice(1).toLowerCase()}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2 space-y-1">
        {conversations.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-8">No conversations yet</p>
        ) : (
          conversations.map((conv) => {
            const active = conv._id === activeConvId;
            return (
              <div
                key={conv._id}
                onClick={() => onSelect(conv)}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <span className="flex-1 text-sm truncate">{conv.title}</span>
                <button
                  aria-label={`Delete ${conv.title}`}
                  onClick={(e) => { e.stopPropagation(); onDelete(conv); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground shrink-0">
        {userName ? <p className="truncate">Signed in as {userName}</p> : <p>Signed in</p>}
      </div>
    </motion.aside>
  );
}
