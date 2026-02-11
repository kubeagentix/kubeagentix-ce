import { useCallback, useRef, useState, useEffect } from "react";
import {
  AgentMessage,
  AgentRequest,
  AgentResponseChunk,
  RequestContext,
  ToolCall,
  ToolPreferences,
  ModelPreferences,
  AgentError,
  StoredConversation,
} from "@shared/coordination";

interface UseAgentOptions {
  conversationId?: string;
  context?: RequestContext;
  onChunk?: (chunk: AgentResponseChunk) => void;
  onComplete?: (messages: AgentMessage[]) => void;
  onError?: (error: AgentError) => void;
}

interface UseAgentState {
  messages: AgentMessage[];
  isLoading: boolean;
  currentTool?: ToolCall;
  error?: AgentError;
  conversationId: string;
}

/**
 * Hook for managing agent interactions
 * Handles message streaming, tool calls, and conversation state
 */
export function useAgent(options: UseAgentOptions = {}) {
  const conversationId = useRef(
    options.conversationId ||
      `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [state, setState] = useState<UseAgentState>({
    messages: [],
    isLoading: false,
    conversationId: conversationId.current,
  });

  const [context, setContext] = useState<RequestContext>(
    options.context || {
      cluster: "default",
      namespace: "default",
    },
  );

  useEffect(() => {
    if (!options.context) return;
    setContext((prev) => {
      const next = options.context as RequestContext;
      const sameCore =
        prev.cluster === next.cluster &&
        prev.namespace === next.namespace &&
        prev.clusterContext === next.clusterContext &&
        prev.scopeId === next.scopeId &&
        prev.workingNamespace === next.workingNamespace &&
        prev.workspaceId === next.workspaceId &&
        prev.tenantId === next.tenantId &&
        prev.integrationProfileId === next.integrationProfileId &&
        prev.environment === next.environment &&
        prev.clientLabel === next.clientLabel &&
        prev.timeRange === next.timeRange;
      const sameResources =
        JSON.stringify(prev.selectedResources || []) ===
        JSON.stringify(next.selectedResources || []);
      return sameCore && sameResources ? prev : next;
    });
  }, [options.context]);

  const [toolPreferences, setToolPreferences] = useState<ToolPreferences>({
    maxToolCalls: 5,
  });

  const [modelPreferences, setModelPreferences] = useState<ModelPreferences>({
    providerId: "claude",
  });

  const subscriptionsRef = useRef<Set<(chunk: AgentResponseChunk) => void>>(
    new Set(),
  );
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Send a message and stream the response
   */
  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim()) return;

      // Add user message to history
      const newMessages: AgentMessage[] = [
        ...state.messages,
        { role: "user", content: userMessage, timestamp: Date.now() },
      ];

      setState((prev) => ({
        ...prev,
        messages: newMessages,
        isLoading: true,
        error: undefined,
      }));

      abortControllerRef.current = new AbortController();

      try {
        // Build request
        const request: AgentRequest = {
          conversationId: state.conversationId,
          userId: "user-123", // TODO: Get from auth context
          messages: newMessages,
          context,
          toolPreferences,
          modelPreferences,
        };

        // Send request and stream response
        const response = await fetch("/api/agent/invoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new AgentError(
            "AGENT_ERROR",
            `Agent request failed: ${response.statusText}`,
            true,
            response.status,
          );
        }

        // Process streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new AgentError(
            "STREAM_ERROR",
            "No response body received",
            false,
          );
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let assistantMessage = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete JSON lines
          const lines = buffer.split("\n");
          buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
              const chunk = JSON.parse(line) as AgentResponseChunk;

              // Call subscribers
              subscriptionsRef.current.forEach((cb) => cb(chunk));
              options.onChunk?.(chunk);

              // Update state based on chunk type
              if (chunk.type === "text" && chunk.text) {
                assistantMessage += chunk.text;
              } else if (chunk.type === "tool_call" && chunk.toolCall) {
                setState((prev) => ({
                  ...prev,
                  currentTool: chunk.toolCall,
                }));
              } else if (chunk.type === "complete") {
                // Add assistant message to history
                if (assistantMessage) {
                  const updatedMessages: AgentMessage[] = [
                    ...newMessages,
                    {
                      role: "assistant",
                      content: assistantMessage,
                      timestamp: Date.now(),
                    },
                  ];

                  setState((prev) => ({
                    ...prev,
                    messages: updatedMessages,
                    isLoading: false,
                    currentTool: undefined,
                  }));

                  options.onComplete?.(updatedMessages);

                  // Save conversation locally
                  saveConversationLocally(updatedMessages);
                }
              } else if (chunk.type === "error" && chunk.error) {
                const error = new AgentError(
                  chunk.error.code,
                  chunk.error.message,
                  chunk.error.retryable,
                );
                setState((prev) => ({
                  ...prev,
                  error,
                  isLoading: false,
                }));
                options.onError?.(error);
              }
            } catch (e) {
              console.error("Failed to parse chunk:", line, e);
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const chunk = JSON.parse(buffer) as AgentResponseChunk;
            subscriptionsRef.current.forEach((cb) => cb(chunk));
            options.onChunk?.(chunk);
          } catch (e) {
            console.error("Failed to parse final chunk:", buffer, e);
          }
        }
      } catch (error) {
        if (error instanceof AgentError) {
          setState((prev) => ({ ...prev, error, isLoading: false }));
          options.onError?.(error);
        } else if (error instanceof Error && error.name !== "AbortError") {
          const agentError = new AgentError(
            "UNKNOWN_ERROR",
            error.message,
            true,
          );
          setState((prev) => ({
            ...prev,
            error: agentError,
            isLoading: false,
          }));
          options.onError?.(agentError);
        }
      }
    },
    [
      state.messages,
      state.conversationId,
      context,
      toolPreferences,
      modelPreferences,
      options,
    ],
  );

  /**
   * Cancel current request
   */
  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  /**
   * Clear conversation history
   */
  const clearHistory = useCallback(() => {
    setState((prev) => ({
      ...prev,
      messages: [],
      conversationId: `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));
    conversationId.current = `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, []);

  /**
   * Subscribe to chunk updates
   */
  const subscribe = useCallback(
    (callback: (chunk: AgentResponseChunk) => void) => {
      subscriptionsRef.current.add(callback);
      return () => subscriptionsRef.current.delete(callback);
    },
    [],
  );

  /**
   * Save conversation to local storage
   */
  const saveConversationLocally = async (messages: AgentMessage[]) => {
    try {
      const conversation: StoredConversation = {
        id: state.conversationId,
        userId: "user-123", // TODO: Get from auth context
        cluster: context.cluster,
        namespace: context.namespace,
        selectedResources: context.selectedResources,
        messages,
        toolCalls: [],
        toolResults: [],
        outcome: "in_progress",
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };

      // Store in IndexedDB or localStorage
      if (typeof window !== "undefined" && "indexedDB" in window) {
        const db = await openDatabase();
        const tx = db.transaction(["conversations"], "readwrite");
        const store = tx.objectStore("conversations");
        await store.put(conversation);
      }
    } catch (error) {
      console.error("Failed to save conversation:", error);
    }
  };

  return {
    // State
    messages: state.messages,
    isLoading: state.isLoading,
    currentTool: state.currentTool,
    error: state.error,
    conversationId: state.conversationId,

    // Context management
    context,
    setContext,
    toolPreferences,
    setToolPreferences,
    modelPreferences,
    setModelPreferences,

    // Methods
    sendMessage,
    cancel,
    clearHistory,
    subscribe,
  };
}

/**
 * Helper to open IndexedDB for local storage
 */
async function openDatabase(): Promise<IDBDatabase> {
  const PRIMARY_DB = "kubeagentix";
  const LEGACY_DB = "kubeagentics";

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRIMARY_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("conversations")) {
        db.createObjectStore("conversations", { keyPath: "id" });
      }
    };

    request.onsuccess = async () => {
      const db = request.result;

      // Best-effort migration from legacy DB name.
      try {
        const legacyDb = await new Promise<IDBDatabase | null>((res) => {
          const legacyReq = indexedDB.open(LEGACY_DB, 1);
          legacyReq.onsuccess = () => res(legacyReq.result);
          legacyReq.onerror = () => res(null);
          legacyReq.onupgradeneeded = () => res(null);
        });

        if (legacyDb && legacyDb.objectStoreNames.contains("conversations")) {
          const readTx = legacyDb.transaction(["conversations"], "readonly");
          const readStore = readTx.objectStore("conversations");
          const allReq = readStore.getAll();

          allReq.onsuccess = () => {
            const entries = (allReq.result || []) as any[];
            if (entries.length === 0) return;
            const writeTx = db.transaction(["conversations"], "readwrite");
            const writeStore = writeTx.objectStore("conversations");
            entries.forEach((entry) => writeStore.put(entry));
          };
        }
      } catch {
        // Ignore migration failures; primary DB remains functional.
      }

      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}
