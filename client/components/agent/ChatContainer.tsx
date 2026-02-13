import { useEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { useAgent } from "@/hooks/useAgent";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { SuggestedQuestions } from "./SuggestedQuestions";
import { StreamingIndicator } from "./StreamingIndicator";

interface ChatContainerProps {
  cluster?: string;
  namespace?: string;
  scopeId?: string;
  workspaceId?: string;
  tenantId?: string;
  integrationProfileId?: string;
  initialPrompt?: string;
}

/**
 * Main chat container component
 * Manages the conversation flow, message display, and user input
 * Integrates with useAgent hook for state management
 */
export function ChatContainer({
  cluster = "default",
  namespace = "default",
  scopeId,
  workspaceId,
  tenantId,
  integrationProfileId,
  initialPrompt,
}: ChatContainerProps) {
  const showProviderDebug = import.meta.env.VITE_SHOW_PROVIDER_DEBUG !== "false";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const initialPromptSentRef = useRef(false);

  // Initialize agent with context
  const agent = useAgent({
    context: {
      cluster,
      namespace,
      clusterContext: cluster,
      scopeId,
      workingNamespace: namespace,
      workspaceId,
      tenantId,
      integrationProfileId,
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [agent.messages]);

  // If routed from terminal diagnosis handoff, auto-send seeded prompt once.
  useEffect(() => {
    if (initialPromptSentRef.current) return;
    if (!initialPrompt?.trim()) return;
    if (agent.messages.length > 0 || agent.isLoading) return;

    initialPromptSentRef.current = true;
    void agent.sendMessage(initialPrompt);
  }, [initialPrompt, agent.messages.length, agent.isLoading]);

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;
    await agent.sendMessage(message);
  };

  const handleSuggestedQuestion = (question: string) => {
    agent.sendMessage(question);
  };

  // Empty state: show greeting + suggested questions
  const isEmpty = agent.messages.length === 0;

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Messages Container */}
      <div
        ref={messageListRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
      >
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full space-y-8">
            {/* Greeting Message */}
            <div className="max-w-2xl text-center space-y-4">
              <div className="flex justify-center">
                <Zap className="w-12 h-12 text-orange-400" />
              </div>
              <h1 className="text-2xl font-semibold text-zinc-100 flex items-baseline justify-center gap-1">
                <span>KubeAgentiX</span>
                <span className="text-base font-semibold uppercase tracking-wide text-[#C2410C]">
                  CE
                </span>
              </h1>
              <p className="text-zinc-300 text-lg leading-relaxed">
                Hello! I'm your Kubernetes AI assistant. I can help you
                troubleshoot issues, diagnose problems, and manage your cluster.
                What would you like to know?
              </p>
            </div>

            {/* Suggested Questions */}
            <SuggestedQuestions
              namespace={namespace}
              onSelect={handleSuggestedQuestion}
            />
            <p className="text-xs text-zinc-500">
              Like KubeAgentiX CE?{" "}
              <a
                href="https://github.com/kubeagentix/kubeagentix-ce"
                target="_blank"
                rel="noreferrer"
                className="text-zinc-300 underline underline-offset-2 hover:text-white transition-colors"
              >
                Star it on GitHub
              </a>
              .
            </p>
          </div>
        )}

        {/* Messages */}
        {!isEmpty && (
          <div className="space-y-4">
            {agent.messages.map((message, index) => (
              <MessageBubble
                key={index}
                role={message.role}
                content={message.content}
                timestamp={message.timestamp}
              />
            ))}

            {/* Loading Indicator */}
            {agent.isLoading && (
              <div className="flex items-center space-x-2 py-4">
                <StreamingIndicator />
              </div>
            )}

            {/* Error Display */}
            {agent.error && (
              <div className="bg-red-900/20 border border-red-700 rounded-lg px-4 py-3 text-red-200">
                <p className="font-semibold text-sm">Error</p>
                <p className="text-sm mt-1">{agent.error.message}</p>
              </div>
            )}
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-zinc-800 bg-zinc-900 p-4">
        {showProviderDebug && agent.lastRunDebug?.providerId && (
          <div className="mb-2 text-xs text-sky-300/90">
            Debug: provider={agent.lastRunDebug.providerId}
            {agent.lastRunDebug.model ? ` model=${agent.lastRunDebug.model}` : ""}
          </div>
        )}
        <ChatInput
          onSubmit={handleSendMessage}
          disabled={agent.isLoading}
          placeholder="Ask anything about your cluster..."
        />
      </div>
    </div>
  );
}
