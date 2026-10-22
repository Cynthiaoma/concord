import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Auth, Conflict, Forbidden, Rejected, Unauthorized, type GoogleProfile, type SessionInfo } from "./auth.js";
import type { NetworkName } from "./config.js";
import { Invalid } from "./concord.js";
import { RateLimiter, Signer, TooMany, newToken, sameText } from "./security.js";

export interface ApiOptions {
  /** The origin users reach the service on. */
  publicUrl: string;
  signup: "open" | "code";
  ephemeral: boolean;
  networks: NetworkName[];
  defaultNetwork: NetworkName;
  maxAssetsPerOrg: number;
  trustProxyHops: number;
  google?: { clientId: string; clientSecret: string };
  /** For tests. */
  fetch?: typeof fetch;
  limiter?: RateLimiter;
}

const MINUTE = 60_000;

/** The address to hold rate limits against. Forwarded headers count only behind a known proxy. */
export function clientIp(c: Context, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const hops = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Each trusted proxy appends the address it saw; the entry before theirs is the client.
    const seen = hops[hops.length - trustProxyHops];
    if (seen) return seen;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function jsonBody<T>(c: Context): Promise<T> {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new Invalid("request body must be JSON");
  }
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new Invalid("request body must be JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Invalid("request body must be a JSON object");
  return value as T;
}

/** Cookie handling shared by the auth routes and the session check on workspace routes. */
export function sessions(auth: Auth, options: ApiOptions) {
  const secure = options.publicUrl.startsWith("https://");
  // The __Host- prefix stops a sibling subdomain planting a cookie of the same name.
  const name = secure ? "__Host-concord_session" : "concord_session";
  return {
    secure,
    read(c: Context): SessionInfo | undefined {
      return auth.session(getCookie(c, name));
    },
    /** Returns the session it started. */
    start(c: Context, userId: string, orgId: string): SessionInfo | undefined {
      const token = auth.startSession(userId, orgId);
      // Strict is enough: the page shell is static and every API call is a same-origin fetch.
      setCookie(c, name, token, {
        path: "/",
        httpOnly: true,
        secure,
        sameSite: "Strict",
        maxAge: 30 * 86_400,
      });
      return auth.session(token);
    },
    end(c: Context): void {
      auth.endSession(getCookie(c, name));
      deleteCookie(c, name, { path: "/", secure });
    },
  };
}

export function me(auth: Auth, session: SessionInfo) {
  return {
    user: {
      ...session.user,
      hasPassword: auth.hasPassword(session.user.id),
      hasGoogle: auth.hasGoogle(session.user.id),
    },
    org: session.org,
    role: session.role,
    orgs: auth.orgsOf(session.user.id),
  };
}

interface OAuthState {
  state: string;
  nonce: string;
  verifier: string;
  invite?: string;
  code?: string;
  /** Set when a signed-in user is connecting Google to their account. */
  link?: string;
}

export function authRoutes(auth: Auth, options: ApiOptions): Hono {
  const app = new Hono();
  const cookies = sessions(auth, options);
  const limiter = options.limiter ?? new RateLimiter();
  const signer = new Signer();
  const doFetch = options.fetch ?? fetch;
  const oauthCookie = cookies.secure ? "__Host-concord_oauth" : "concord_oauth";
  const redirectUri = `${options.publicUrl}/api/auth/google/callback`;

  const limit = (key: string, max: number, windowMs: number) => {
    const wait = limiter.hit(key, max, windowMs);
    if (wait > 0) throw new TooMany(wait);
  };
  const need = (c: Context): SessionInfo => {
    const session = cookies.read(c);
    if (!session) throw new Unauthorized("Sign in to continue.");
    return session;
  };
  const respond = (c: Context, userId: string, orgId: string, status: 200 | 201 = 200) => {
    const session = cookies.start(c, userId, orgId);
    if (!session) throw new Unauthorized("Sign in to continue.");
    return c.json(me(auth, session), status);
  };

  app.get("/config", (c) =>
    c.json({
      signup: options.signup,
      google: Boolean(options.google),
      ephemeral: options.ephemeral,
      networks: options.networks,
      defaultNetwork: options.defaultNetwork,
    }),
  );

  app.get("/me", (c) => c.json(me(auth, need(c))));

  // What the dashboard asks on load. Being signed out is an ordinary answer here, not an error.
  app.get("/session", (c) => {
    const session = cookies.read(c);
    return c.json({ me: session ? me(auth, session) : null });
  });

  app.post("/signup", async (c) => {
    limit(`signup:${clientIp(c, options.trustProxyHops)}`, 20, 60 * MINUTE);
    const input = await jsonBody<{ email: unknown; name: unknown; password: unknown; orgName: unknown; code?: unknown }>(c);
    const { userId, orgId } = await auth.signUp(input);
    return respond(c, userId, orgId, 201);
  });

  app.post("/signin", async (c) => {
    const input = await jsonBody<{ email: unknown; password: unknown }>(c);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 254) : "";
    limit(`signin:${clientIp(c, options.trustProxyHops)}`, 20, 10 * MINUTE);
    const failures = `signin-failed:${email}`;
    const locked = limiter.blocked(failures, 10);
    if (locked > 0) throw new TooMany(locked);
    try {
      const { userId, orgId } = await auth.signIn(email, input.password);
      limiter.clear(failures);
      return respond(c, userId, orgId);
    } catch (err) {
      if (err instanceof Unauthorized) limiter.hit(failures, 10, 15 * MINUTE);
      throw err;
    }
  });

  app.post("/signout", (c) => {
    cookies.end(c);
    return c.json({ ok: true });
  });

  app.post("/password", async (c) => {
    const session = need(c);
    limit(`password:${session.user.id}`, 10, 15 * MINUTE);
    const input = await jsonBody<{ current?: unknown; next: unknown }>(c);
    await auth.changePassword(session, input.current, input.next);
    return c.json({ ok: true });
  });

  app.post("/switch-org", async (c) => {
    const session = need(c);
    const input = await jsonBody<{ orgId: unknown }>(c);
    auth.switchOrg(session, input.orgId);
    return c.json(me(auth, need(c)));
  });

  app.post("/invites/lookup", async (c) => {
    limit(`invite:${clientIp(c, options.trustProxyHops)}`, 20, 10 * MINUTE);
    const input = await jsonBody<{ token: unknown }>(c);
    const invite = auth.lookupInvite(input.token);
    if (!invite) throw new Rejected("This invitation is no longer valid. Ask for a new one.");
    return c.json(invite);
  });

  app.post("/invites/accept", async (c) => {
    limit(`invite:${clientIp(c, options.trustProxyHops)}`, 20, 10 * MINUTE);
    const input = await jsonBody<{ token: unknown; name?: unknown; password?: unknown }>(c);
    const session = cookies.read(c);
    const { userId, orgId } = await auth.acceptInvite(input.token, { session, name: input.name, password: input.password });
    if (session) {
      auth.switchOrg(session, orgId);
      return c.json(me(auth, need(c)));
    }
    return respond(c, userId, orgId, 201);
  });

  app.post("/reset", async (c) => {
    limit(`reset:${clientIp(c, options.trustProxyHops)}`, 20, 10 * MINUTE);
    const input = await jsonBody<{ token: unknown; password: unknown }>(c);
    const { userId, orgId } = await auth.resetPassword(input.token, input.password);
    return respond(c, userId, orgId);
  });

  // ── Google ────────────────────────────────────────────────────────────────

  const back = (c: Context, hash: string) => c.redirect(`${options.publicUrl}/#${hash}`, 302);

  app.get("/google/start", (c) => {
    const google = options.google;
    if (!google) return c.json({ error: "Google sign-in is not set up on this server." }, 404);
    limit(`google:${clientIp(c, options.trustProxyHops)}`, 30, 10 * MINUTE);
    const pending: OAuthState = { state: newToken(16), nonce: newToken(16), verifier: newToken(32) };
    const invite = c.req.query("invite");
    const code = c.req.query("code");
    if (invite) pending.invite = invite.slice(0, 200);
    if (code) pending.code = code.slice(0, 200);
    if (c.req.query("link")) {
      // Recorded now, while the session cookie is present; Google's redirect back will not carry it.
      pending.link = need(c).user.id;
    }
    setCookie(c, oauthCookie, signer.seal(pending), {
      path: "/",
      httpOnly: true,
      secure: cookies.secure,
      // Lax, not Strict: this one has to survive the navigation back from Google.
      sameSite: "Lax",
      maxAge: 600,
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get("/google/callback", async (c) => {
    const google = options.google;
    if (!google) return c.json({ error: "Google sign-in is not set up on this server." }, 404);
    const pending = signer.open<OAuthState>(getCookie(c, oauthCookie));
    deleteCookie(c, oauthCookie, { path: "/", secure: cookies.secure });
    const failed = (reason: string) => back(c, `${pending?.link ? "/settings" : "/signin"}?error=${reason}`);
    if (c.req.query("error")) return failed("google_cancelled");
    const code = c.req.query("code");
    if (!pending || !code || !sameText(c.req.query("state") ?? "", pending.state)) return failed("google_failed");

    let profile: GoogleProfile;
    try {
      const res = await doFetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: pending.verifier,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
      const { id_token: idToken } = (await res.json()) as { id_token?: string };
      // The token came straight from Google over TLS, so its claims can be read without
      // checking the signature; they are still checked for who they were issued to and when.
      const claims = JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString()) as {
        iss?: string;
        aud?: string;
        exp?: number;
        nonce?: string;
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
      if (!issuerOk || claims.aud !== google.clientId || !claims.sub || !claims.email) throw new Error("unexpected claims");
      if (!claims.exp || claims.exp * 1000 < Date.now() || claims.nonce !== pending.nonce) throw new Error("stale token");
      profile = {
        sub: claims.sub,
        email: claims.email,
        name: claims.name ?? "",
        emailVerified: claims.email_verified === true,
      };
    } catch (err) {
      console.error(`google sign-in: ${(err as Error).message}`);
      return failed("google_failed");
    }

    try {
      if (pending.link) {
        auth.linkGoogle(pending.link, profile);
        return back(c, "/settings?linked=google");
      }
      const context: { invite?: string; code?: string } = {};
      if (pending.invite) context.invite = pending.invite;
      if (pending.code) context.code = pending.code;
      const { userId, orgId } = auth.googleSignIn(profile, context);
      cookies.start(c, userId, orgId);
      return back(c, "/");
    } catch (err) {
      if (err instanceof Conflict) return failed("google_exists");
      if (err instanceof Rejected) return failed("google_mismatch");
      if (err instanceof Forbidden) return failed(profile.emailVerified ? "signup_code" : "google_unverified");
      console.error(err);
      return failed("google_failed");
    }
  });

  return app;
}
