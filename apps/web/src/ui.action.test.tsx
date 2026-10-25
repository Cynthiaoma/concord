import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAction } from "./ui";

describe("useAction", () => {
  it("sets busy while pending, resolves true on success and clears busy", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const { result } = renderHook(() => useAction());
    let done!: Promise<boolean>;

    act(() => { done = result.current.run(() => pending); });
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBeUndefined();

    await act(async () => {
      resolve();
      expect(await done).toBe(true);
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("resolves false for Error rejection and shows its message", async () => {
    const { result } = renderHook(() => useAction());
    let ok!: boolean;
    await act(async () => {
      ok = await result.current.run(async () => { throw new Error("Access denied"); });
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("Access denied");
    expect(result.current.busy).toBe(false);
  });

  it("clears the previous error before starting another action", async () => {
    const { result } = renderHook(() => useAction());
    await act(async () => { await result.current.run(async () => { throw Error("old error"); }); });
    expect(result.current.error).toBe("old error");

    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    let done!: Promise<boolean>;
    act(() => { done = result.current.run(() => pending); });
    expect(result.current.error).toBeUndefined();
    expect(result.current.busy).toBe(true);

    await act(async () => { resolve(); expect(await done).toBe(true); });
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("converts non-Error rejection values to displayable text", async () => {
    const { result } = renderHook(() => useAction());
    let ok!: boolean;
    await act(async () => {
      ok = await result.current.run(async () => { throw "service offline"; });
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("service offline");
  });
});
