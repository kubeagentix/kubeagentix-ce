import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "../MessageBubble";

describe("MessageBubble", () => {
  it("renders user message with correct styling", () => {
    const { container } = render(
      <MessageBubble role="user" content="Hello agent" />,
    );

    const bubble = container.querySelector("[class*='bg-sky-400']");
    expect(bubble).toBeInTheDocument();
    expect(screen.getByText("Hello agent")).toBeInTheDocument();
  });

  it("renders assistant message with correct styling", () => {
    const { container } = render(
      <MessageBubble role="assistant" content="Hello user" />,
    );

    const bubble = container.querySelector(".bg-zinc-800");
    expect(bubble).toBeInTheDocument();
    expect(screen.getByText("Hello user")).toBeInTheDocument();
  });

  it("displays timestamp when provided", () => {
    const timestamp = new Date("2024-01-15T10:30:00").getTime();
    render(
      <MessageBubble role="user" content="Message" timestamp={timestamp} />,
    );

    // Timestamp should be visible
    const timeElements = screen.getAllByText(/10:30/i);
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it("handles multi-line content correctly", () => {
    const multilineContent = "Line 1\nLine 2\nLine 3";
    render(<MessageBubble role="assistant" content={multilineContent} />);

    expect(screen.getByText(/Line 1/)).toBeInTheDocument();
  });

  it("renders markdown content for assistant messages", () => {
    const markdownContent =
      "Here are pods:\n\n- **pod-a**: Running\n- `pod-b`: Pending";
    render(<MessageBubble role="assistant" content={markdownContent} />);

    expect(screen.getByText("pod-a")).toBeInTheDocument();
    expect(screen.getByText("pod-b")).toBeInTheDocument();
  });

  it("user message aligns to right", () => {
    const { container } = render(<MessageBubble role="user" content="Test" />);

    const wrapper = container.querySelector(".justify-end");
    expect(wrapper).toBeInTheDocument();
  });

  it("assistant message aligns to left", () => {
    const { container } = render(
      <MessageBubble role="assistant" content="Test" />,
    );

    const wrapper = container.querySelector(".justify-start");
    expect(wrapper).toBeInTheDocument();
  });
});
