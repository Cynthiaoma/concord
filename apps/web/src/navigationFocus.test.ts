import { afterEach, describe, expect, it, vi } from "vitest";
import { focusRouteContent } from "./navigationFocus";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("hash route accessibility", () => {
  it("moves from the previous scroll and focus position to the new page heading", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    document.body.innerHTML = '<a href="#/a/asset">Asset</a><main><h1>Asset overview</h1></main>';
    document.querySelector("a")?.focus();
    focusRouteContent();
    const heading = document.querySelector("h1");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(heading?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(heading);
    vi.unstubAllGlobals();
  });

  it("focuses main when content has not loaded a heading yet", () => {
    vi.stubGlobal("scrollTo", vi.fn());
    document.body.innerHTML = "<main>Loading data</main>";
    focusRouteContent();
    expect(document.activeElement).toBe(document.querySelector("main"));
    vi.unstubAllGlobals();
  });
});
