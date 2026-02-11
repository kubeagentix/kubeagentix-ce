import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SendIcon } from "lucide-react";

interface ChatInputProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Chat input component
 * Handles text input with multi-line support and send functionality
 */
export function ChatInput({
  onSubmit,
  disabled = false,
  placeholder = "Ask anything about your cluster...",
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120,
      )}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Shift+Enter for new line
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      setInput(input + "\n");
    }
  };

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSubmit(input.trim());
      setInput("");
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  return (
    <div className="flex gap-3">
      {/* Text Input */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="flex-1 min-h-10 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-orange-700 focus:ring-1 focus:ring-orange-400 resize-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      />

      {/* Send Button */}
      <Button
        onClick={handleSubmit}
        disabled={disabled || !input.trim()}
        size="icon"
        aria-label="Send"
        className="h-10 w-10 flex-shrink-0 bg-sky-400/60 hover:bg-sky-400/70 text-white disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        <SendIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
