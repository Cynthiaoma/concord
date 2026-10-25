import { afterEach, describe, expect, it, vi } from "vitest";
import { UNAUTHORIZED, api, download } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("session-expiration notifications", () => {
  it("does not log out a valid session for sign-in or invite-accept failures", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Wrong credentials" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const expired = vi.fn();
    window.addEventListener(UNAUTHORIZED, expired);
    try {
      await expect(api("/auth/signin", { body: { email: "x", password: "wrong" } })).rejects.toMatchObject({ status: 401 });
      await expect(api("/auth/invites/accept", { body: {} })).rejects.toMatchObject({ status: 401 });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(UNAUTHORIZED, expired);
    }
  });

  it("still resets when a protected request or download receives 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Session expired" }), { status: 401 }),
    );
    const expired = vi.fn();
    window.addEventListener(UNAUTHORIZED, expired);
    try {
      await expect(api("/overview")).rejects.toMatchObject({ status: 401 });
      await expect(download("/assets/ABC/export", "export.csv")).rejects.toMatchObject({ status: 401 });
      expect(expired).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(UNAUTHORIZED, expired);
    }
  });
});
