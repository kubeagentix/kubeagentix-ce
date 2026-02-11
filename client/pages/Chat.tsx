import { AppShell } from "@/components/layout/AppShell";
import { ChatContainer } from "@/components/agent/ChatContainer";
import { useState } from "react";
import { useWorkspaceScope } from "@/lib/workspaceScope";

const CHAT_HANDOFF_STORAGE_KEY = "kubeagentix_chat_handoff";

interface ChatHandoffPayload {
  source: string;
  query: string;
  cluster?: string;
  namespace?: string;
  recentTerminalContext?: Array<{
    type: "input" | "output" | "error";
    content: string;
  }>;
}

function readChatHandoff(): ChatHandoffPayload | null {
  if (typeof window === "undefined") return null;

  const raw = sessionStorage.getItem(CHAT_HANDOFF_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ChatHandoffPayload;
    sessionStorage.removeItem(CHAT_HANDOFF_STORAGE_KEY);
    return parsed;
  } catch {
    sessionStorage.removeItem(CHAT_HANDOFF_STORAGE_KEY);
    return null;
  }
}

function buildInitialPrompt(handoff: ChatHandoffPayload | null): string | undefined {
  if (!handoff?.query?.trim()) return undefined;

  const contextLines = (handoff.recentTerminalContext || [])
    .slice(-2)
    .map((entry) => `- ${entry.type.toUpperCase()}: ${entry.content}`)
    .join("\n");

  return [
    "I am coming from the Terminal panel and need diagnosis help.",
    `Question: ${handoff.query.trim()}`,
    `Cluster: ${handoff.cluster || "current-selected"}`,
    `Namespace: ${handoff.namespace || "current-selected"}`,
    contextLines ? "Recent terminal context:\n" + contextLines : "",
    "Please diagnose the issue and suggest safe next kubectl commands.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Chat Page
 * Main page for the chat interface
 * Uses ChatContainer component for message management and display
 */
export default function Chat() {
  const scope = useWorkspaceScope();
  const [handoff] = useState<ChatHandoffPayload | null>(() => readChatHandoff());
  const cluster = handoff?.cluster || scope.clusterContext;
  const namespace = handoff?.namespace || scope.workingNamespace || "all";
  const initialPrompt = buildInitialPrompt(handoff);

  return (
    <AppShell mode="chat">
      <div className="h-[calc(100vh-140px)] flex flex-col">
        <ChatContainer
          cluster={cluster}
          namespace={namespace}
          scopeId={scope.scopeId}
          workspaceId={scope.workspaceId}
          tenantId={scope.tenantId}
          integrationProfileId={scope.integrationProfileId}
          initialPrompt={initialPrompt}
        />
      </div>
    </AppShell>
  );
}
