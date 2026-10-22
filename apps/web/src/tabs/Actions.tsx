import { useState } from "react";
import { api, type Action, type AssetSummary } from "../api";
import { BreakTable } from "../breaks";
import {
  Addr,
  Button,
  Empty,
  ErrorNote,
  Field,
  Figures,
  LOCAL_TIME_HINT,
  Notice,
  Section,
  Skeleton,
  StatusBadge,
  TableWrap,
  Tx,
  Units,
  inputClass,
  localToIso,
  useAction,
  useLoad,
  when,
} from "../ui";

function NewAction({ asset, assets, onDone }: { asset: AssetSummary; assets: AssetSummary[]; onDone: (id: number) => void }) {
  const [type, setType] = useState<Action["type"]>("dividend");
  const [label, setLabel] = useState("");
  const [record, setRecord] = useState("");
  const [until, setUntil] = useState("");
  const [rate, setRate] = useState("");
  const [payAsset, setPayAsset] = useState(asset.id);
  const [payer, setPayer] = useState("");
  const [num, setNum] = useState("2");
  const [den, setDen] = useState("1");
  const { busy, error, run } = useAction();
  return (
    <form
      className="flex flex-col gap-4 rounded border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const body: Record<string, unknown> = { type, recordTime: localToIso(record) };
          if (label.trim()) body.label = label.trim();
          if (until) body.windowTo = localToIso(until);
          if (type === "dividend") {
            body.ratePerUnit = rate.trim();
            body.payAsset = payAsset;
            if (payer.trim()) body.payer = payer.trim();
          } else {
            body.num = num;
            body.den = den;
          }
          const created = await api<Action>(`/assets/${asset.id}/actions`, { method: "POST", body });
          onDone(created.id);
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as Action["type"];
              setType(next);
              // A split defaults to two for one. A redemption cannot exceed the holding, so it defaults to all of it.
              setNum(next === "redemption" ? "1" : "2");
              setDen("1");
            }}
            className={inputClass}
          >
            <option value="dividend">Dividend or distribution</option>
            <option value="split">Split</option>
            <option value="redemption">Redemption</option>
          </select>
        </Field>
        <Field label="Record time" hint={`Holdings at this instant set the entitlement. ${LOCAL_TIME_HINT}`}>
          <input type="datetime-local" value={record} onChange={(e) => setRecord(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Execution window ends" hint="Optional. Open-ended when empty.">
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className={inputClass} />
        </Field>
      </div>
      {type === "dividend" ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Rate per unit" hint="Pay-asset units per whole unit held.">
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={`${inputClass} num`} required />
          </Field>
          <Field label="Paid in" hint="A watched asset on the same network. The same asset means paid in kind.">
            <select value={payAsset} onChange={(e) => setPayAsset(e.target.value)} className={inputClass}>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}
                  {a.id === asset.id ? " (in kind)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Paying agent address" hint="Empty counts mints of the pay asset.">
            <input value={payer} onChange={(e) => setPayer(e.target.value)} className={`${inputClass} num`} spellCheck={false} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label={type === "split" ? "New units" : "Units redeemed"}
            hint={type === "split" ? "2 for 1 is new 2, old 1." : "1 of 1 redeems in full."}
          >
            <input value={num} onChange={(e) => setNum(e.target.value)} inputMode="numeric" className={`${inputClass} num`} required />
          </Field>
          <Field label={type === "split" ? "Old units" : "Out of"}>
            <input value={den} onChange={(e) => setDen(e.target.value)} inputMode="numeric" className={`${inputClass} num`} required />
          </Field>
        </div>
      )}
      <Field label="Label" hint="Optional name for reports.">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
      </Field>
      {error && <ErrorNote message={error} />}
      <div>
        <Button variant="primary" busy={busy} type="submit">
          Snapshot and reconcile
        </Button>
      </div>
    </form>
  );
}

function Detail({ asset, action, onChange }: { asset: AssetSummary; action: Action; onChange: () => void }) {
  const { busy, error, run } = useAction();
  const res = action.result;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{action.label}</h3>
          <p className="text-[13px] text-muted">
            Record {when(action.recordTime)}
            {action.snapshot ? `, snapshot at ledger ${action.snapshot.ledger} with ${action.snapshot.holderCount} holders` : ""}
          </p>
        </div>
        <Button
          busy={busy}
          onClick={() =>
            void run(async () => {
              await api(`/actions/${action.id}/reconcile`, { method: "POST" });
              onChange();
            })
          }
        >
          Reconcile again
        </Button>
      </div>
      {error && <ErrorNote message={error} />}
      {action.state === "scheduled" && (
        <Notice>
          The indexed chain has not reached the record time yet. Concord takes the snapshot and reconciles this action
          by itself once it does.
        </Notice>
      )}
      {res && (
        <>
          {res.warnings.map((w) => (
            <Notice key={w}>{w}</Notice>
          ))}
          <Figures
            items={[
              { label: "Result", value: <StatusBadge status={action.state} /> },
              { label: `Expected (${res.flowAsset.code})`, value: <Units value={res.summary.expectedTotal} /> },
              { label: `Observed (${res.flowAsset.code})`, value: <Units value={res.summary.observedTotal} /> },
              {
                label: "Difference",
                value: <Units value={res.summary.difference} signed />,
                ...(res.summary.difference === "0" ? {} : { tone: "bad" as const }),
              },
              { label: "Open breaks", value: action.openBreaks, tone: action.openBreaks ? ("bad" as const) : ("ok" as const) },
            ]}
          />
          {res.breaks.length > 0 && (
            <Section title="Breaks">
              <BreakTable assetId={asset.id} breaks={res.breaks} onChange={onChange} />
            </Section>
          )}
          <Section
            title="Entitlements"
            aside={<span className="text-xs text-muted">Chain read through {when(res.reconciledThrough)}</span>}
          >
            {res.lines.length === 0 && (
              <p className="text-[13px] text-muted">Nobody held units at the record time, so nothing was due.</p>
            )}
            <TableWrap>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Holder</th>
                    <th className="r">Record holding</th>
                    <th className="r">Expected</th>
                    <th className="r">Observed</th>
                    <th className="r">Difference</th>
                    <th>Result</th>
                    <th>Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {res.lines.map((l) => (
                    <tr key={l.address}>
                      <td>
                        <Addr value={l.address} />
                      </td>
                      <td className="r">
                        <Units value={l.basis} />
                      </td>
                      <td className="r">
                        <Units value={l.expected} />
                      </td>
                      <td className="r">
                        <Units value={l.observed} />
                      </td>
                      <td className="r">
                        <Units value={l.difference} signed />
                      </td>
                      <td>
                        <StatusBadge status={l.status} />
                      </td>
                      <td>
                        <span className="flex flex-wrap gap-2">
                          {l.txHashes.map((h) => (
                            <Tx key={h} hash={h} />
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
        </>
      )}
    </div>
  );
}

export function Actions({ asset, assets, onChange }: { asset: AssetSummary; assets: AssetSummary[]; onChange: () => void }) {
  const list = useLoad(() => api<Action[]>(`/assets/${asset.id}/actions`), [asset.id]);
  const [selected, setSelected] = useState<number | undefined>();
  const [creating, setCreating] = useState(false);
  const refresh = (id?: number) => {
    if (id) setSelected(id);
    setCreating(false);
    list.reload();
    onChange();
  };
  if (list.loading && !list.data) return <Skeleton rows={6} />;
  if (list.error) return <ErrorNote message={list.error} />;
  const actions = list.data ?? [];
  const current = actions.find((a) => a.id === selected) ?? actions[0];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-[65ch] text-[13px] text-muted">
          Each action freezes holdings at its record time, works out what every holder is owed, and compares that with
          what the ledger shows afterwards.
        </p>
        <Button variant="primary" onClick={() => setCreating(!creating)}>
          {creating ? "Cancel" : "New action"}
        </Button>
      </div>
      {creating && <NewAction asset={asset} assets={assets} onDone={refresh} />}
      {actions.length === 0 && !creating && (
        <Empty title="No corporate actions yet">
          Record a dividend, split or redemption to take a record-date snapshot and reconcile its execution.
        </Empty>
      )}
      {actions.length > 0 && (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Action</th>
                <th>Type</th>
                <th>Record time</th>
                <th>Result</th>
                <th className="r">Open breaks</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                  className={`cursor-pointer ${a.id === current?.id ? "bg-sunken" : "hover:bg-sunken"}`}
                >
                  <td>
                    <button type="button" className="text-left font-medium" onClick={() => setSelected(a.id)}>
                      {a.label}
                    </button>
                  </td>
                  <td className="capitalize">{a.type}</td>
                  <td className="whitespace-nowrap text-[13px]">{when(a.recordTime)}</td>
                  <td>
                    <StatusBadge status={a.state} />
                  </td>
                  <td className="r num">{a.openBreaks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {current && <Detail asset={asset} action={current} onChange={() => refresh(current.id)} />}
    </div>
  );
}
