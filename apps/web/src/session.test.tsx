import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, showOrg, UNAUTHORIZED, type Me } from "./api";
import { SessionProvider, useSession } from "./session";

const me: Me = {
  user: { id: "u1", email: "owner@example.com", name: "Owner", hasPassword: true, hasGoogle: false },
  org: { id: "org-one", name: "Test workspace" },
  role: "owner",
  orgs: [{ id: "org-one", name: "Test workspace", role: "owner" }],
};

const config = {
  signup: "open",
  google: false,
  ephemeral: false,
  networks: ["testnet", "mainnet"],
  defaultNetwork: "testnet",
};

const requests: { path: string; headers?: HeadersInit }[] = [];

function SessionView() {
  const { me: current } = useSession();
  return <div data-testid="email">{current?.user.email ?? "signed-out"}</div>;
}

function mount() {
  return render(
    <SessionProvider fallback={() => <div>starting</div>}>
      <SessionView />
    </SessionProvider>,
  );
}

describe("SessionProvider unauthorized handling", () => {
  beforeEach(() => {
    requests.length = 0;
    showOrg(undefined);
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      requests.push({ path, headers: init?.headers });
      const body = path === "/api/auth/config" ? config
        : path === "/api/auth/session" ? { me }
        : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
  });

  afterEach(() => {
    showOrg(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clears the user and shown workspace after UNAUTHORIZED", async () => {
    mount();
    expect(await screen.findByTestId("email")).toHaveTextContent("owner@example.com");
    await api("/probe-before");
    const before = requests.find((r) => r.path === "/api/probe-before");
    expect(before?.headers).toHaveProperty("x-concord-org", "org-one");

    await act(async () => { window.dispatchEvent(new Event(UNAUTHORIZED)); });
    expect(screen.getByTestId("email")).toHaveTextContent("signed-out");

    await api("/probe-after");
    const after = requests.find((r) => r.path === "/api/probe-after");
    expect(after?.headers).not.toHaveProperty("x-concord-org");
  });

  it("removes the global unauthorized listener on unmount", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const add = vi.spyOn(window, "addEventListener");
    const view = mount();
    expect(await screen.findByTestId("email")).toHaveTextContent("owner@example.com");
    expect(add.mock.calls.some(([type]) => type === UNAUTHORIZED)).toBe(true);
    view.unmount();
    await waitFor(() => expect(remove.mock.calls.some(([type]) => type === UNAUTHORIZED)).toBe(true));
  });
});
