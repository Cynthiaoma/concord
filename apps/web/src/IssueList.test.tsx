import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueList } from "./ui";

const issue = (line: number, message = "Invalid amount") => ({ line, message });

describe("IssueList CSV import errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders no placeholder for zero issues", () => {
    const { container } = render(<IssueList issues={[]} what="register" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the singular summary and line number, expanded by default", () => {
    const { container } = render(<IssueList issues={[issue(7)]} what="register" />);
    expect(screen.getByText("1 row of the register not loaded")).toBeInTheDocument();
    expect(screen.getByText("line 7")).toBeInTheDocument();
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("opens five issues but collapses six", () => {
    const five = Array.from({ length: 5 }, (_, i) => issue(i + 2));
    const { container, rerender } = render(<IssueList issues={five} what="journal" />);
    expect(screen.getByText("5 rows of the journal not loaded")).toBeInTheDocument();
    expect(container.querySelector("details")).toHaveAttribute("open");
    rerender(<IssueList issues={[...five, issue(7)]} what="journal" />);
    expect(screen.getByText("6 rows of the journal not loaded")).toBeInTheDocument();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("keeps duplicate row/message pairs without a React key warning", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<IssueList issues={[issue(3), issue(3)]} what="instructions" />);
    expect(screen.getAllByText("line 3")).toHaveLength(2);
    expect(screen.getAllByText("Invalid amount")).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("same key"),
      expect.anything(),
    );
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
  });
});
