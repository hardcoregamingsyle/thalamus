// Local rendering types for /chat. Deliberately separate from
// @/lib/types's ChatMessageRow: a notice (model-unavailable, transient
// network/rate-limit errors) is never persisted by the gateway and has no
// row of its own — it only exists in this timeline for the current tab.
import type { ChatMessageRow } from "./types";

export type NoticeKind = "model_unavailable" | "error";

export interface TimelineNotice {
  kind: "notice";
  id: string;
  noticeKind: NoticeKind;
  text: string;
  /** Present only for retryable notices (brief: "Other errors → ... Retry"). */
  onRetry?: () => void;
}

export interface TimelineMessage {
  kind: "message";
  message: ChatMessageRow;
}

export type TimelineItem = TimelineMessage | TimelineNotice;
