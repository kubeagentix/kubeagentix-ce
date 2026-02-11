import { useMemo } from "react";
import { formatTime } from "@/lib/utils";
import { ResponseFormatter } from "./ResponseFormatter";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

/**
 * Message bubble component for displaying chat messages
 * Supports both user and assistant messages with different styling
 */
export function MessageBubble({
  role,
  content,
  timestamp,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const timeString = useMemo(() => {
    if (!timestamp) return null;
    return formatTime(timestamp);
  }, [timestamp]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-lg px-4 py-3 space-y-2 ${
          isUser
            ? "max-w-2xl bg-sky-400/60 text-white"
            : "max-w-4xl bg-zinc-800 text-zinc-100 border border-zinc-700"
        }`}
      >
        {/* Message Content */}
        <div className="text-sm leading-relaxed break-words">
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{content}</div>
          ) : (
            <ResponseFormatter content={content} />
          )}
        </div>

        {/* Timestamp */}
        {timeString && (
          <div
            className={`text-xs ${isUser ? "text-sky-100" : "text-zinc-400"}`}
          >
            {timeString}
          </div>
        )}
      </div>
    </div>
  );
}
