import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatContainer } from "../ChatContainer";

const sendMessageMock = vi.fn();

// Mock the useAgent hook
vi.mock("@/hooks/useAgent", () => ({
  useAgent: () => ({
    messages: [],
    isLoading: false,
    error: null,
    sendMessage: sendMessageMock,
    cancel: vi.fn(),
    clearHistory: vi.fn(),
  }),
}));

describe("ChatContainer", () => {
  beforeEach(() => {
    sendMessageMock.mockClear();
  });

  it("renders with greeting message on empty state", () => {
    render(<ChatContainer cluster="test-cluster" namespace="default" />);

    expect(
      screen.getByText(/I'm your Kubernetes AI assistant/i),
    ).toBeInTheDocument();
  });

  it("displays suggested questions", () => {
    render(<ChatContainer cluster="test-cluster" namespace="default" />);

    expect(
      screen.getByText(/Which namespaces can I access/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Show me pods in the default namespace/i),
    ).toBeInTheDocument();
  });

  it("renders chat input component", () => {
    render(<ChatContainer cluster="test-cluster" namespace="default" />);

    const input = screen.getByPlaceholderText(
      /Ask anything about your cluster/i,
    );
    expect(input).toBeInTheDocument();
  });

  it("renders send button", () => {
    render(<ChatContainer cluster="test-cluster" namespace="default" />);

    const sendButton = screen.getByRole("button", { name: /send/i });
    expect(sendButton).toBeInTheDocument();
  });

  it("has responsive design class", () => {
    const { container } = render(
      <ChatContainer cluster="test-cluster" namespace="default" />,
    );

    const mainDiv = container.firstChild;
    expect(mainDiv).toHaveClass("flex", "flex-col", "h-full");
  });

  it("auto-sends initial prompt when provided", () => {
    render(
      <ChatContainer
        cluster="test-cluster"
        namespace="default"
        initialPrompt="Diagnose issue from terminal context"
      />,
    );

    expect(sendMessageMock).toHaveBeenCalledWith(
      "Diagnose issue from terminal context",
    );
  });
});
