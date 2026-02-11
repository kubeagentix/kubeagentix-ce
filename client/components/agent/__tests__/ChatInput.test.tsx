import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "../ChatInput";

describe("ChatInput", () => {
  it("renders input field with placeholder", () => {
    render(<ChatInput onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText(
      /Ask anything about your cluster/i,
    );
    expect(input).toBeInTheDocument();
  });

  it("renders send button", () => {
    render(<ChatInput onSubmit={vi.fn()} />);

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("calls onSubmit when send button is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(
      /Ask anything about your cluster/i,
    );
    await user.type(input, "Test message");

    const button = screen.getByRole("button");
    await user.click(button);

    expect(onSubmit).toHaveBeenCalledWith("Test message");
  });

  it("calls onSubmit when Enter key is pressed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(
      /Ask anything about your cluster/i,
    );
    await user.type(input, "Test message{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("Test message");
  });

  it("allows multi-line input with Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(
      /Ask anything about your cluster/i,
    ) as HTMLTextAreaElement;
    await user.type(input, "Line 1{Shift>}{Enter}{/Shift}Line 2");

    expect(input.value).toContain("Line 1");
    expect(input.value).toContain("Line 2");
  });

  it("disables input when disabled prop is true", () => {
    render(<ChatInput onSubmit={vi.fn()} disabled={true} />);

    const input = screen.getByPlaceholderText(
      /Ask anything about your cluster/i,
    );
    expect(input).toBeDisabled();
  });

  it("clears input after submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(
      /Ask anything about your cluster/i,
    ) as HTMLTextAreaElement;
    await user.type(input, "Test message");

    const button = screen.getByRole("button");
    await user.click(button);

    expect(input.value).toBe("");
  });

  it("does not submit empty messages", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatInput onSubmit={onSubmit} />);

    const button = screen.getByRole("button");
    await user.click(button);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
