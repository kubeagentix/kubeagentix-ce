import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KubectlTerminal } from "../KubectlTerminal";

const executeCommandMock = vi.fn();
const suggestCommandMock = vi.fn();
const clearSuggestionMock = vi.fn();
const navigateMock = vi.fn();

const useTerminalSessionMock = vi.fn(() => ({
  lines: [{ id: "1", type: "output", content: "kubectl terminal ready" }],
  history: [],
  isExecuting: false,
  executeCommand: executeCommandMock,
}));

const useCommandSuggestionMock = vi.fn(() => ({
  suggestion: null,
  loading: false,
  error: null,
  errorCode: null,
  suggestCommand: suggestCommandMock,
  clearSuggestion: clearSuggestionMock,
}));

vi.mock("@/hooks/useTerminalSession", () => ({
  useTerminalSession: () => useTerminalSessionMock(),
}));

vi.mock("@/hooks/useCommandSuggestion", () => ({
  useCommandSuggestion: () => useCommandSuggestionMock(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

describe("KubectlTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useTerminalSessionMock.mockReturnValue({
      lines: [{ id: "1", type: "output", content: "kubectl terminal ready" }],
      history: [],
      isExecuting: false,
      executeCommand: executeCommandMock,
    });
    useCommandSuggestionMock.mockReturnValue({
      suggestion: null,
      loading: false,
      error: null,
      errorCode: null,
      suggestCommand: suggestCommandMock,
      clearSuggestion: clearSuggestionMock,
    });
  });

  it("renders mode selector with command and natural language modes", () => {
    render(<KubectlTerminal />);
    expect(screen.getByLabelText("Mode")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Command" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Natural Language" })).toBeInTheDocument();
  });

  it("submits natural language query to suggestion endpoint flow", async () => {
    const user = userEvent.setup();
    render(<KubectlTerminal namespace="default" context="prod-us-west" />);

    await user.selectOptions(screen.getByLabelText("Mode"), "natural_language");
    await user.type(
      screen.getByPlaceholderText("Describe what you want to inspect..."),
      "show non-running pods across all namespaces",
    );
    await user.click(screen.getByRole("button", { name: "Suggest command" }));

    expect(suggestCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "show non-running pods across all namespaces",
        context: "prod-us-west",
        namespace: "default",
      }),
    );
  });

  it("shows suggestion panel and supports edit + execute", async () => {
    const user = userEvent.setup();
    useCommandSuggestionMock.mockReturnValue({
      suggestion: {
        query: "show pods",
        suggestedCommand: "kubectl get pods -n default",
        source: "heuristic",
        confidence: 85,
        rationale: "Matched pod listing intent.",
        assumptions: ["Using namespace 'default'."],
        warnings: [],
        policyDecision: { allowed: true, family: "kubectl", subcommand: "get" },
        generatedAt: Date.now(),
      },
      loading: false,
      error: null,
      errorCode: null,
      suggestCommand: suggestCommandMock,
      clearSuggestion: clearSuggestionMock,
    });

    render(<KubectlTerminal />);
    await user.selectOptions(screen.getByLabelText("Mode"), "natural_language");

    const editableCommand = screen.getByDisplayValue("kubectl get pods -n default");
    await user.clear(editableCommand);
    await user.type(editableCommand, "kubectl get pods -A");

    await user.click(screen.getByRole("button", { name: "Execute command" }));
    expect(executeCommandMock).toHaveBeenCalledWith("kubectl get pods -A");
    expect(clearSuggestionMock).toHaveBeenCalled();
  });

  it("disables execute for blocked suggestions", async () => {
    const user = userEvent.setup();
    useCommandSuggestionMock.mockReturnValue({
      suggestion: {
        query: "apply manifest",
        suggestedCommand: "kubectl apply -f bad.yaml",
        source: "agentic",
        confidence: 70,
        rationale: "Generated command.",
        assumptions: [],
        warnings: ["Blocked by policy."],
        policyDecision: {
          allowed: false,
          family: "kubectl",
          subcommand: "apply",
          reason: "Subcommand not allowed: apply",
        },
        generatedAt: Date.now(),
      },
      loading: false,
      error: null,
      errorCode: null,
      suggestCommand: suggestCommandMock,
      clearSuggestion: clearSuggestionMock,
    });

    render(<KubectlTerminal />);
    await user.selectOptions(screen.getByLabelText("Mode"), "natural_language");
    expect(screen.getByRole("button", { name: "Execute command" })).toBeDisabled();
  });

  it("auto-switches command mode english input to natural language suggestion", async () => {
    const user = userEvent.setup();
    render(<KubectlTerminal namespace="dev" context="prod-us-west" />);

    await user.type(
      screen.getByPlaceholderText("Enter kubectl command..."),
      "lsit all deployments in dev",
    );
    await user.click(screen.getByRole("button", { name: "Run command" }));

    await waitFor(() => {
      expect(suggestCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "lsit all deployments in dev",
          context: "prod-us-west",
          namespace: "dev",
        }),
      );
    });
    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Detected natural-language input/i)).toBeInTheDocument();
  });

  it("shows go to chat button for diagnosis-style unavailable suggestions", async () => {
    const user = userEvent.setup();
    useCommandSuggestionMock.mockReturnValue({
      suggestion: null,
      loading: false,
      error: "This request is better handled in Chat. Switch to the Chat panel and ask the same question for RCA.",
      errorCode: "SUGGESTION_UNAVAILABLE",
      suggestCommand: suggestCommandMock,
      clearSuggestion: clearSuggestionMock,
    });

    render(<KubectlTerminal />);
    await user.selectOptions(screen.getByLabelText("Mode"), "natural_language");
    await user.click(screen.getByRole("button", { name: "Go to Chat" }));

    expect(clearSuggestionMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/chat?handoff=terminal");
    expect(sessionStorage.getItem("kubeagentix_chat_handoff")).toBeTruthy();
  });
});
