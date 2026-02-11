import { useMemo } from "react";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

interface ResponseFormatterProps {
  content: string;
  isStreaming?: boolean;
}

function normalizeAssistantMarkdown(raw: string): string {
  if (!raw.trim()) return raw;

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];
  let inCodeFence = false;
  let inSectionList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      inSectionList = false;
      normalized.push(line);
      continue;
    }

    if (inCodeFence) {
      normalized.push(line);
      continue;
    }

    if (!trimmed) {
      inSectionList = false;
      normalized.push("");
      continue;
    }

    const isSectionHeading = /^[A-Za-z][A-Za-z0-9 /_-]{1,60}:$/.test(trimmed);
    if (isSectionHeading) {
      inSectionList = true;
      normalized.push(`**${trimmed}**`);
      continue;
    }

    const isAlreadyMarkdown = /^([-*+]\s|\d+\.\s|>\s|#{1,6}\s|\|)/.test(
      trimmed,
    );
    if (isAlreadyMarkdown) {
      inSectionList = true;
      normalized.push(line);
      continue;
    }

    const listLikeLine =
      trimmed.includes(":") ||
      /\([^)]+\)/.test(trimmed) ||
      /\s-\s/.test(trimmed);

    if (inSectionList && listLikeLine) {
      normalized.push(`- ${trimmed}`);
      continue;
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

/**
 * Response formatter component
 * Handles markdown rendering, code highlighting, and formatting
 */
export function ResponseFormatter({
  content,
  isStreaming = false,
}: ResponseFormatterProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const formattedContent = useMemo(
    () => normalizeAssistantMarkdown(content),
    [content],
  );

  // Parse fenced code blocks for copy affordance while delegating rendering to markdown.
  const blocks = useMemo(() => {
    const blockRegex = /```(\w*)\n?([\s\S]*?)```/gm;
    const matches = [...formattedContent.matchAll(blockRegex)];

    return matches.map((match, index) => ({
      index,
      language: match[1] || "text",
      code: match[2]?.trim() || "",
    }));
  }, [formattedContent]);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="space-y-3 text-white max-w-none">
      <div className="prose prose-invert prose-zinc max-w-none text-sm leading-relaxed break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            code(props) {
              const { className, children, ...rest } = props;
              const language = className?.replace("language-", "") || "text";
              const code = String(children).replace(/\n$/, "");
              const isInline = !className;

              if (isInline) {
                return (
                  <code
                    {...rest}
                    className="bg-zinc-700/70 px-1.5 py-0.5 rounded text-xs font-mono text-orange-300"
                  >
                    {children}
                  </code>
                );
              }

              const codeIndex = blocks.findIndex((block) => block.code === code);
              const copyIndex = codeIndex >= 0 ? codeIndex : 0;

              return (
                <div className="my-3 bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
                    <span className="text-xs font-mono text-zinc-400">
                      {language}
                    </span>
                    <button
                      onClick={() => handleCopy(code, copyIndex)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition"
                    >
                      {copiedIndex === copyIndex ? (
                        <>
                          <Check className="w-3 h-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="m-0 p-4 overflow-x-auto bg-zinc-950">
                    <code className="text-xs sm:text-sm font-mono text-zinc-100 whitespace-pre">
                      {code}
                    </code>
                  </pre>
                </div>
              );
            },
            a(props) {
              return (
                <a
                  {...props}
                  className="text-sky-300 hover:text-sky-200 underline underline-offset-2"
                  target="_blank"
                  rel="noreferrer"
                />
              );
            },
            ul(props) {
              return (
                <ul
                  {...props}
                  className="my-2 list-disc pl-5 marker:text-orange-300 space-y-1"
                />
              );
            },
            ol(props) {
              return (
                <ol
                  {...props}
                  className="my-2 list-decimal pl-5 marker:text-orange-300 space-y-1"
                />
              );
            },
            p(props) {
              return <p {...props} className="my-1.5 leading-6 text-zinc-100" />;
            },
            strong(props) {
              return <strong {...props} className="text-zinc-50 font-semibold" />;
            },
          }}
        >
          {formattedContent}
        </ReactMarkdown>
      </div>

      {isStreaming && (
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
          Streaming response...
        </div>
      )}
    </div>
  );
}
