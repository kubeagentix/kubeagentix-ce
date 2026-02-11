/**
 * Streaming indicator component
 * Shows animated dots while agent is processing/responding
 */
export function StreamingIndicator() {
  return (
    <div className="flex items-center space-x-1">
      <div className="text-zinc-400 text-sm">Agent thinking</div>
      <div className="flex space-x-1">
        <div
          className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
          style={{ animationDelay: "0s" }}
        />
        <div
          className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
          style={{ animationDelay: "0.1s" }}
        />
        <div
          className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
          style={{ animationDelay: "0.2s" }}
        />
      </div>
    </div>
  );
}
