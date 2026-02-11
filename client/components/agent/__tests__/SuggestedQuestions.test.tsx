import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestedQuestions } from "../SuggestedQuestions";

describe("SuggestedQuestions", () => {
  it("renders with default questions", () => {
    render(<SuggestedQuestions onSelect={vi.fn()} />);

    expect(
      screen.getByText(/Which namespaces can I access/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Show me pods in the default namespace/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Show warning events in the default namespace/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Show non-running pods across all namespaces/i),
    ).toBeInTheDocument();
  });

  it("renders custom questions when provided", () => {
    const customQuestions = ["Custom question 1", "Custom question 2"];
    render(
      <SuggestedQuestions questions={customQuestions} onSelect={vi.fn()} />,
    );

    expect(screen.getByText("Custom question 1")).toBeInTheDocument();
    expect(screen.getByText("Custom question 2")).toBeInTheDocument();
  });

  it("calls onSelect when question is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <SuggestedQuestions questions={["Test question"]} onSelect={onSelect} />,
    );

    const button = screen.getByText("Test question");
    await user.click(button);

    expect(onSelect).toHaveBeenCalledWith("Test question");
  });

  it("displays 'Suggested Questions' header", () => {
    render(<SuggestedQuestions onSelect={vi.fn()} />);

    expect(screen.getByText("Suggested Questions")).toBeInTheDocument();
  });

  it("renders as grid layout on desktop", () => {
    const { container } = render(<SuggestedQuestions onSelect={vi.fn()} />);

    const grid = container.querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2");
  });

  it("uses provided namespace in default questions", () => {
    render(<SuggestedQuestions namespace="dev" onSelect={vi.fn()} />);

    expect(
      screen.getByText(/Show me pods in the dev namespace/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Show warning events in the dev namespace/i),
    ).toBeInTheDocument();
  });
});
