import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, type Me } from "./api";
import { useSession } from "./session";
import { Button, ErrorNote, Field, LinkButton, Notice, Skeleton, inputClass, useAction, useLoad } from "./ui";

const PASSWORD_MIN = 10;

/** What the server reports back in the address bar when Google sign-in does not go through. */
const GOOGLE_ERRORS: Record<string, string> = {
  google_exists: "An account with this email already exists. Sign in with its password, then connect Google under Settings.",
  google_unverified: "Google has not verified that email address, so it cannot be used to sign in.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in did not complete. Try again.",
  google_mismatch: "Connect the Google account that uses the same email address as your Concord account.",
  signup_code: "New workspaces need a valid sign-up code from the operator of this server.",
};

export function googleError(code: string | undefined): string | undefined {
  return code ? (GOOGLE_ERRORS[code] ?? GOOGLE_ERRORS.google_failed) : undefined;
}

export function EphemeralNotice() {
  const { config } = useSession();
  if (!config.ephemeral) return null;
  return (
    <Notice>
      This is a preview server. Everything saved here, accounts included, is erased whenever it restarts, which happens
      after about fifteen quiet minutes. Do not rely on it to keep anything.
    </Notice>
  );
}

function Frame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-[100dvh] max-w-[1080px] grid-cols-1 content-start gap-x-16 gap-y-12 px-4 py-10 md:grid-cols-[minmax(0,380px)_1fr] md:py-20">
      <main id="main" className="flex flex-col gap-6">
        <a href="#/" className="text-base font-semibold tracking-tight">
          Concord
        </a>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight [text-wrap:balance]">{title}</h1>
          {lead && <p className="text-[13px] text-muted [text-wrap:pretty]">{lead}</p>}
        </div>
        <EphemeralNotice />
        {children}
      </main>
      <aside aria-label="About Concord" className="md:border-l md:border-line md:pl-12 md:pt-12">
        <dl className="flex max-w-[46ch] flex-col divide-y divide-line">
          {[
            [
              "Reads the ledger",
              "Concord indexes the transfer, mint, burn, clawback and authorisation events of the assets you watch on Stellar. It never holds keys and cannot move anything.",
            ],
            [
              "Compares with your register",
              "You upload the register your transfer-agent system exports. Every position that disagrees with the chain is listed with both figures, until someone signs it off.",
            ],
            [
              "Private to your workspace",
              "Each workspace keeps its books in a database of its own. Colleagues join by an invitation you send; nobody else can see what you upload.",
            ],
          ].map(([term, text]) => (
            <div key={term} className="flex flex-col gap-1 py-4 first:pt-0">
              <dt className="text-[13px] font-medium">{term}</dt>
              <dd className="text-[13px] text-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}

function Password({
  label,
  value,
  onChange,
  fresh,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** A new password being chosen, as opposed to an existing one being entered. */
  fresh?: boolean;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const short = fresh && value.length > 0 && value.length < PASSWORD_MIN;
  return (
    <Field
      label={label}
      {...(hint || fresh ? { hint: hint ?? `At least ${PASSWORD_MIN} characters.` } : {})}
      {...(short ? { error: `${PASSWORD_MIN - value.length} more characters needed.` } : {})}
    >
      <span className="flex gap-2">
        <input
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={fresh ? "new-password" : "current-password"}
          minLength={fresh ? PASSWORD_MIN : undefined}
          className={inputClass}
          required
        />
        <Button onClick={() => setShown(!shown)} aria-pressed={shown} className="shrink-0">
          {shown ? "Hide" : "Show"}
        </Button>
      </span>
    </Field>
  );
}

export { Password };

function Google({ query = "", label }: { query?: string; label: string }) {
  const { config } = useSession();
  if (!config.google) return null;
  return (
    <>
      <p className="flex items-center gap-3 text-xs text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
        or
      </p>
      <LinkButton href={`/api/auth/google/start${query}`} className="justify-center">
        {label}
      </LinkButton>
    </>
  );
}

function useSubmit(send: () => Promise<Me>) {
  const { adopt } = useSession();
  const action = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => adopt(await send()));
  };
  return { ...action, submit };
}

export function SignIn({ error }: { error?: string | undefined }) {
  const { config } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useSubmit(() => api<Me>("/auth/signin", { body: { email, password } }));
  return (
    <Frame title="Sign in" lead="Reconcile tokenized securities on Stellar against the official register.">
      <form className="flex flex-col gap-4" onSubmit={form.submit}>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={inputClass} required autoFocus />
        </Field>
        <Password label="Password" value={password} onChange={setPassword} />
        {(form.error ?? error) && <ErrorNote message={form.error ?? error ?? ""} />}
        <Button variant="primary" busy={form.busy} type="submit" className="justify-center">
          {form.busy ? "Signing in" : "Sign in"}
        </Button>
        <Google label="Continue with Google" />
      </form>
      <p className="text-[13px] text-muted">
        No workspace yet?{" "}
        <a href="#/signup" className="font-medium text-accent hover:underline">
          Create one
        </a>
        {config.signup === "code" && ". You will need a sign-up code from the operator of this server."}
      </p>
    </Frame>
  );
}

export function SignUp({ error }: { error?: string | undefined }) {
  const { config } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const form = useSubmit(() =>
    api<Me>("/auth/signup", { body: { name, email, orgName, password, ...(config.signup === "code" ? { code: code.trim() } : {}) } }),
  );
  return (
    <Frame title="Create a workspace" lead="A workspace holds the assets your organisation watches and the books you upload against them.">
      <form className="flex flex-col gap-4" onSubmit={form.submit}>
        {config.signup === "code" && (
          <Field label="Sign-up code" hint="Issued by the operator of this server. Each code opens one workspace.">
            <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} num`} spellCheck={false} required />
          </Field>
        )}
        <Field label="Your name" hint="Shown beside every break you sign off.">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass} maxLength={80} required autoFocus />
        </Field>
        <Field label="Work email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={inputClass} required />
        </Field>
        <Field label="Workspace name" hint="Usually your organisation. You can change it later.">
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization" className={inputClass} maxLength={80} required />
        </Field>
        <Password label="Password" value={password} onChange={setPassword} fresh />
        {(form.error ?? error) && <ErrorNote message={form.error ?? error ?? ""} />}
        <Button variant="primary" busy={form.busy} type="submit" className="justify-center">
          {form.busy ? "Creating" : "Create workspace"}
        </Button>
        <Google
          label="Sign up with Google"
          query={config.signup === "code" && code.trim() ? `?code=${encodeURIComponent(code.trim())}` : ""}
        />
      </form>
      <p className="text-[13px] text-muted">
        Already have an account?{" "}
        <a href="#/signin" className="font-medium text-accent hover:underline">
          Sign in
        </a>
      </p>
    </Frame>
  );
}

interface InviteInfo {
  org: string;
  email: string;
  role: "owner" | "member";
  hasAccount: boolean;
}

export function Invite({ token }: { token: string }) {
  const { me, adopt, signOut } = useSession();
  const invite = useLoad(() => api<InviteInfo>("/auth/invites/lookup", { body: { token } }), [token]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const done = () => {
    location.hash = "#/";
  };
  const join = useAction();
  const accept = (body: Record<string, unknown>) =>
    join.run(async () => {
      await adopt(await api<Me>("/auth/invites/accept", { body: { token, ...body } }));
      done();
    });

  if (invite.loading) {
    return (
      <Frame title="Invitation">
        <Skeleton rows={3} />
      </Frame>
    );
  }
  if (invite.error || !invite.data) {
    return (
      <Frame title="Invitation">
        <ErrorNote message={invite.error ?? "This invitation is no longer valid. Ask for a new one."} />
        <p className="text-[13px]">
          <a href="#/" className="font-medium text-accent hover:underline">
            Back to Concord
          </a>
        </p>
      </Frame>
    );
  }
  const info = invite.data;
  const asInvited = me?.user.email.toLowerCase() === info.email.toLowerCase();
  const lead = `You have been invited to ${info.org} as ${info.role === "owner" ? "an owner" : "a member"}, at ${info.email}.`;

  if (me && asInvited) {
    return (
      <Frame title={`Join ${info.org}`} lead={lead}>
        {join.error && <ErrorNote message={join.error} />}
        <div>
          <Button variant="primary" busy={join.busy} onClick={() => void accept({})}>
            Join workspace
          </Button>
        </div>
      </Frame>
    );
  }
  if (me) {
    return (
      <Frame title={`Join ${info.org}`} lead={lead}>
        <Notice>
          You are signed in as {me.user.email}. This invitation is for {info.email}; sign out and use that account to
          accept it.
        </Notice>
        <div>
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </Frame>
    );
  }
  if (info.hasAccount) {
    return <InviteSignIn email={info.email} lead={lead} org={info.org} token={token} />;
  }
  return (
    <Frame title={`Join ${info.org}`} lead={lead}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void accept({ name, password });
        }}
      >
        <Field label="Your name" hint="Shown beside every break you sign off.">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass} maxLength={80} required autoFocus />
        </Field>
        <Password label="Choose a password" value={password} onChange={setPassword} fresh />
        {join.error && <ErrorNote message={join.error} />}
        <Button variant="primary" busy={join.busy} type="submit" className="justify-center">
          {join.busy ? "Joining" : "Join workspace"}
        </Button>
        <Google label="Join with Google" query={`?invite=${encodeURIComponent(token)}`} />
      </form>
    </Frame>
  );
}

/** The invited address already has an account: sign in as it, and the invitation waits. */
function InviteSignIn({ email, lead, org, token }: { email: string; lead: string; org: string; token: string }) {
  const [password, setPassword] = useState("");
  const form = useSubmit(() => api<Me>("/auth/signin", { body: { email, password } }));
  return (
    <Frame title={`Join ${org}`} lead={lead}>
      <form className="flex flex-col gap-4" onSubmit={form.submit}>
        <p className="text-[13px]">Sign in as {email} to accept.</p>
        <Password label="Password" value={password} onChange={setPassword} />
        {form.error && <ErrorNote message={form.error} />}
        <Button variant="primary" busy={form.busy} type="submit" className="justify-center">
          {form.busy ? "Signing in" : "Sign in"}
        </Button>
        <Google label="Continue with Google" query={`?invite=${encodeURIComponent(token)}`} />
      </form>
    </Frame>
  );
}

export function Reset({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const form = useSubmit(() => api<Me>("/auth/reset", { body: { token, password } }));
  const { me } = useSession();
  useEffect(() => {
    // Once the new password is set the server signs the visitor in; leave the spent link behind.
    if (me && !form.busy && password) location.hash = "#/";
  }, [me, form.busy, password]);
  return (
    <Frame title="Set a new password" lead="This link works once. Setting a password signs out every other session of the account.">
      <form className="flex flex-col gap-4" onSubmit={form.submit}>
        <Password label="New password" value={password} onChange={setPassword} fresh />
        {form.error && <ErrorNote message={form.error} />}
        <Button variant="primary" busy={form.busy} type="submit" className="justify-center">
          {form.busy ? "Saving" : "Set password and sign in"}
        </Button>
      </form>
    </Frame>
  );
}
