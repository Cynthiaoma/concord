import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WarningList } from "./WarningList";

afterEach(() => vi.restoreAllMocks());

describe("warning lists", () => {
  it("renders repeated messages as separate notices without duplicate React keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<WarningList warnings={["RPC unavailable", "RPC unavailable", "Sync delayed"]} />);
    expect(screen.getAllByText("RPC unavailable")).toHaveLength(2);
    expect(screen.getByText("Sync delayed")).toBeInTheDocument();
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/unique "key"|same key/);
  });
});
