import { useState } from "react";
import { api, type Break } from "./api";
import { useMe } from "./session";
import { Addr, Button, ErrorNote, Field, StatusBadge, TableWrap, Tx, Units, inputClass, useAction, when } from "./ui";

const LABELS: Record<string, string> = {
  QUANTITY_MISMATCH: "Quantity mismatch",
  MISSING_IN_REGISTER: "Not on register",
  MISSING_ON_CHAIN: "Not on chain",
  UNMAPPED_HOLDER: "Unmapped holder",
  STATUS_MISMATCH: "Status mismatch",
  SUPPLY_MISMATCH: "Supply mismatch",
  INCOMPLETE_HISTORY: "Incomplete history",
  UNRECORDED_MOVEMENT: "Unrecorded movement",
  UNSETTLED_ENTRY: "Unsettled entry",
  MOVEMENT_AMOUNT_MISMATCH: "Movement amount mismatch",
  MISSING: "Missing",
  SHORT: "Short",
  EXCESS: "Excess",
  UNEXPECTED: "Unexpected",
  UNINSTRUCTED_CONTROL: "Uninstructed control",
  UNEXECUTED_INSTRUCTION: "Unexecuted instruction",
};

function SignOff({ assetId, item, onDone }: { assetId: string; item: Break; onDone: () => void }) {
  const me = useMe();
  const [note, setNote] = useState(item.note ?? "");
  const { busy, error, run } = useAction();
  // Who signed is taken from the session on the server; nothing typed here can change it.
  const save = (status: Break["status"]) =>
    run(async () => {
      if (status !== "open" && !note.trim()) throw new Error("Write a note first: it is what an auditor reads beside this sign-off.");
      await api(`/assets/${assetId}/notes`, {
        method: "PUT",
        body: { scope: item.noteScope, key: item.key, fingerprint: item.fingerprint, status, note },
      });
      onDone();
    });
  return (
    <div className="flex flex-col gap-3 bg-sunken px-3 py-3">
      <p className="text-[13px]">{item.message}</p>
      {item.noteStale && (
        <p className="text-xs text-warn">
          The figures changed after the last sign-off, so this break reopened. The earlier note is kept below.
        </p>
      )}
      <Field label="Note" hint={`Required to acknowledge or resolve. Kept in the audit export, signed as ${me.user.name} (${me.user.email}).`}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={4000}
          className={`${inputClass} h-auto py-1.5`}
        />
      </Field>
      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} onClick={() => void save("acknowledged")}>
          Acknowledge
        </Button>
        <Button busy={busy} variant="primary" onClick={() => void save("resolved")}>
          Resolve
        </Button>
        {item.status !== "open" && (
          <Button busy={busy} onClick={() => void save("open")}>
            Reopen
          </Button>
        )}
        {item.noteAt && (
          <span className="self-center text-xs text-muted">
            Last note {when(item.noteAt)}
            {item.noteAuthor ? ` by ${item.noteAuthor}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/** One break list for every scope: positions, movements, distributions and controls. */
export function BreakTable({ assetId, breaks, onChange }: { assetId: string; breaks: Break[]; onChange: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const distribution = breaks.some((b) => b.scope === "distribution");
  const control = breaks.every((b) => b.scope === "control");
  return (
    <TableWrap>
      <table className="tbl">
        <thead>
          <tr>
            <th>Break</th>
            <th>Subject</th>
            {!control && <th className="r">{distribution ? "Expected" : "Chain"}</th>}
            {!control && <th className="r">{distribution ? "Observed" : "Register"}</th>}
            {!control && <th className="r">Difference</th>}
            <th>First seen</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {breaks.map((b) => (
            <BreakRow
              key={b.key}
              assetId={assetId}
              item={b}
              control={control}
              expanded={open === b.key}
              onToggle={() => setOpen(open === b.key ? null : b.key)}
              onDone={() => {
                setOpen(null);
                onChange();
              }}
            />
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function BreakRow(props: {
  assetId: string;
  item: Break;
  control: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const { item: b, control } = props;
  return (
    <>
      <tr>
        <td className="font-medium">{LABELS[b.type] ?? b.type}</td>
        <td>
          <div className="flex flex-col gap-0.5">
            {b.address ? (
              <Addr value={b.address} />
            ) : b.ref ? (
              <span className="num">{b.ref}</span>
            ) : b.holderIds?.length ? (
              <span className="num">{b.holderIds.join(", ")}</span>
            ) : (
              <span className="text-muted">Whole asset</span>
            )}
            {b.address && b.holderIds && b.holderIds.length > 0 && (
              <span className="text-xs text-muted">{b.holderIds.join(", ")}</span>
            )}
            {b.address && b.ref && <span className="num text-xs text-muted">{b.ref}</span>}
            <Tx hash={b.txHash} />
          </div>
        </td>
        {!control && (
          <td className="r">
            <Units value={b.expected ?? b.chainUnits} />
          </td>
        )}
        {!control && (
          <td className="r">
            <Units value={b.observed ?? b.registerUnits} />
          </td>
        )}
        {!control && (
          <td className="r">
            <Units value={b.difference} signed />
          </td>
        )}
        <td className="whitespace-nowrap text-[13px] text-muted">{b.firstSeen ? b.firstSeen.slice(0, 10) : ""}</td>
        <td>
          <StatusBadge status={b.status} />
        </td>
        <td className="r">
          <Button onClick={props.onToggle} aria-expanded={props.expanded}>
            {props.expanded ? "Close" : "Review"}
          </Button>
        </td>
      </tr>
      {props.expanded && (
        <tr>
          <td colSpan={control ? 5 : 8} className="!p-0">
            <SignOff assetId={props.assetId} item={b} onDone={props.onDone} />
          </td>
        </tr>
      )}
    </>
  );
}
