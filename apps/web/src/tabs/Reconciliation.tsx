import { WarningList } from "../WarningList";
import { useRef, useState } from "react";
import { api, type AssetSummary, type Issue, type RegisterFile, type Run, type RunSummary } from "../api";
import { BreakTable } from "../breaks";
import {
  Addr,
  Button,
  Empty,
  ErrorNote,
  Field,
  Figures,
  IssueList,
  LOCAL_TIME_HINT,
  Section,
  Skeleton,
  StatusBadge,
  TableWrap,
  TemplateLink,
  Units,
  inputClass,
  localToIso,
  readFile,
  useAction,
  useLoad,
  when,
} from "../ui";

function nowLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Imports({
  asset,
  hasRuns,
  onDone,
}: {
  asset: AssetSummary;
  hasRuns: boolean;
  onDone: (runId?: number) => void;
}) {
  const register = useRef<HTMLInputElement>(null);
  const journal = useRef<HTMLInputElement>(null);
  const [asOf, setAsOf] = useState(nowLocal);
  const reg = useAction();
  const jr = useAction();
  const [journalNote, setJournalNote] = useState<string>();
  const [journalIssues, setJournalIssues] = useState<Issue[]>([]);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void reg.run(async () => {
            const csv = await readFile(register.current?.files?.[0]);
            const out = await api<{ run: Run | null }>(`/assets/${asset.id}/registers`, {
              body: { csv, asOf: localToIso(asOf), source: register.current?.files?.[0]?.name },
            });
            onDone(out.run?.id);
          });
        }}
      >
        <Field
          label="Register export"
          hint="CSV with holder_id and units. Optional: holder_name, account (the holder's Stellar address) and status (active or frozen)."
        >
          <input ref={register} type="file" accept=".csv,text/csv" className={`${inputClass} py-1`} />
        </Field>
        <TemplateLink kind="register" />
        <Field label="Register as of" hint={`Chain holdings are taken at this instant. ${LOCAL_TIME_HINT}`}>
          <input type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputClass} required />
        </Field>
        {reg.error && <ErrorNote message={reg.error} />}
        <div>
          <Button variant="primary" busy={reg.busy} type="submit">
            {reg.busy ? "Reconciling" : "Import and reconcile"}
          </Button>
        </div>
      </form>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void jr.run(async () => {
            const csv = await readFile(journal.current?.files?.[0]);
            const out = await api<{ entries: number; issues: Issue[] }>(`/assets/${asset.id}/journal`, { body: { csv } });
            setJournalIssues(out.issues);
            setJournalNote(
              `${out.entries} ${out.entries === 1 ? "entry" : "entries"} loaded. ${
                hasRuns ? "Re-run the reconciliation to match them against the chain." : "They are matched when a register is reconciled."
              }`,
            );
          });
        }}
      >
        <Field
          label="Transaction journal (optional)"
          hint="CSV with ref, date, type (issue, transfer, redeem or clawback) and units. Optional: from_account, to_account, tx_hash. Enables movement matching."
        >
          <input ref={journal} type="file" accept=".csv,text/csv" className={`${inputClass} py-1`} />
        </Field>
        <TemplateLink kind="journal" />
        {jr.error && <ErrorNote message={jr.error} />}
        {journalNote && (
          <p role="status" className="text-[13px] text-muted">
            {journalNote}
          </p>
        )}
        <IssueList issues={journalIssues} what="journal" />
        <div>
          <Button busy={jr.busy} type="submit">
            Import journal
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Every register file imported for the asset, with the rows it turned away and a way to remove it. */
function Registers({ asset, files, onChange }: { asset: AssetSummary; files: RegisterFile[]; onChange: () => void }) {
  const [confirming, setConfirming] = useState<number>();
  const remove = useAction();
  if (files.length === 0) return null;
  return (
    <Section title="Imported registers">
      {remove.error && <ErrorNote message={remove.error} />}
      <TableWrap>
        <table className="tbl">
          <thead>
            <tr>
              <th>As of</th>
              <th>File</th>
              <th className="r">Positions</th>
              <th className="r">Rows not loaded</th>
              <th>Imported</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td className="whitespace-nowrap text-[13px]">{when(f.asOf)}</td>
                <td className="max-w-[28ch] truncate text-[13px]" title={f.source}>
                  {f.source}
                </td>
                <td className="r num">{f.positions}</td>
                <td className="r num" title={f.issues.map((i) => `line ${i.line}: ${i.message}`).join("\n")}>
                  {f.issues.length}
                </td>
                <td className="text-[13px] text-muted">
                  {f.importedAt.slice(0, 10)}
                  {f.importedBy ? ` by ${f.importedBy.replace(/ <.*>$/, "")}` : ""}
                </td>
                <td className="r">
                  {confirming === f.id ? (
                    <span className="inline-flex gap-2">
                      <Button
                        variant="danger"
                        busy={remove.busy}
                        onClick={() =>
                          void remove.run(async () => {
                            await api(`/assets/${asset.id}/registers/${f.id}`, { method: "DELETE" });
                            setConfirming(undefined);
                            onChange();
                          })
                        }
                      >
                        Delete with its runs
                      </Button>
                      <Button onClick={() => setConfirming(undefined)}>Keep</Button>
                    </span>
                  ) : (
                    <Button onClick={() => setConfirming(f.id)}>Delete</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="text-xs text-muted">Deleting a register also deletes the reconciliations run against it.</p>
    </Section>
  );
}

export function Reconciliation({ asset, onChange }: { asset: AssetSummary; onChange: () => void }) {
  const [selected, setSelected] = useState<number | undefined>();
  const [showImport, setShowImport] = useState(false);
  const [onlyBreaks, setOnlyBreaks] = useState(true);
  const [version, setVersion] = useState(0);
  // One read, in order: the list decides which run to show, so a run that was just deleted
  // along with its register is never asked for.
  const view = useLoad(async () => {
    const [list, registers] = await Promise.all([
      api<RunSummary[]>(`/assets/${asset.id}/reconciliations`),
      api<RegisterFile[]>(`/assets/${asset.id}/registers`),
    ]);
    const id = list.some((x) => x.id === selected) ? selected : list[0]?.id;
    const run = id === undefined ? undefined : await api<Run>(`/reconciliations/${id}`);
    return { list, registers, run };
  }, [asset.id, selected, version]);
  const rerun = useAction();
  const refresh = (id?: number) => {
    setSelected(id);
    setShowImport(false);
    setVersion((v) => v + 1);
    onChange();
  };

  if (view.loading && !view.data) return <Skeleton rows={8} />;
  if (!view.data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorNote message={view.error ?? "The reconciliations could not be loaded."} />
        <Button onClick={view.reload}>Try again</Button>
      </div>
    );
  }
  const { list, registers, run: r } = view.data;
  if (asset.state === "indexing") {
    return (
      <Empty title="Still reading the chain">
        A register can be reconciled once the asset's holdings are in. This page updates on its own.
      </Empty>
    );
  }
  if (list.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Empty title="No register imported yet">
          Export the register from your transfer-agent system as CSV and import it below. Concord compares it with
          on-chain holdings at the as-of time and lists every break.
        </Empty>
        <Imports asset={asset} hasRuns={false} onDone={refresh} />
      </div>
    );
  }

  // Rows the selected run's register file had turned away, kept with the file itself.
  const issues: Issue[] = registers.find((f) => f.id === r?.registerId)?.issues ?? [];
  const lines = r ? (onlyBreaks ? r.lines.filter((l) => !l.matched) : r.lines) : [];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Reconciliation">
          <select
            value={r?.id ?? ""}
            onChange={(e) => setSelected(Number(e.target.value))}
            className={`${inputClass} min-w-[280px]`}
          >
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {when(x.asOf)} · {x.status === "clean" ? "clean" : `${x.openBreaks} open`}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2">
          <Button
            busy={rerun.busy}
            onClick={() =>
              void rerun.run(async () => {
                const out = await api<Run>(`/assets/${asset.id}/reconciliations`, {
                  body: r ? { registerId: r.registerId } : {},
                });
                refresh(out.id);
              })
            }
          >
            Re-run
          </Button>
          <Button variant="primary" onClick={() => setShowImport(!showImport)}>
            {showImport ? "Close import" : "Import register"}
          </Button>
        </div>
      </div>
      {rerun.error && <ErrorNote message={rerun.error} />}
      {showImport && <Imports asset={asset} hasRuns onDone={refresh} />}
      <IssueList issues={issues} what="register" />

      {view.error && <ErrorNote message={`Showing what was last loaded. ${view.error}`} />}
      {r && (
        <>
          <WarningList warnings={r.warnings} />
          <Figures
            items={[
              { label: "Result", value: <StatusBadge status={r.status} /> },
              { label: "Units on chain", value: <Units value={r.summary.chainSupply} /> },
              { label: "Units on register", value: <Units value={r.summary.registerTotal} /> },
              {
                label: "Supply difference",
                value: <Units value={r.summary.supplyDifference} signed />,
                ...(r.summary.supplyDifference === "0" ? {} : { tone: "bad" as const }),
              },
              { label: "Positions matched", value: `${r.summary.matchedLines} of ${r.summary.lines}` },
              {
                label: "Open breaks",
                value: r.openBreaks,
                tone: r.openBreaks > 0 ? ("bad" as const) : ("ok" as const),
              },
            ]}
          />

          <Section
            title="Breaks"
            aside={
              <span className="text-xs text-muted">
                Chain ledger {r.chainLedger}
                {r.movement ? `, ${r.movement.matched} of ${r.movement.entries} journal entries matched` : ", no journal loaded"}
              </span>
            }
          >
            {r.breaks.length === 0 ? (
              <Empty title="The books agree">Every register position matches the chain at {when(r.asOf)}.</Empty>
            ) : (
              <BreakTable assetId={asset.id} breaks={r.breaks} onChange={refresh.bind(null, r.id)} />
            )}
          </Section>

          <Section
            title="Positions"
            aside={
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={onlyBreaks} onChange={(e) => setOnlyBreaks(e.target.checked)} />
                Only unmatched
              </label>
            }
          >
            {lines.length === 0 ? (
              <p className="text-[13px] text-muted">No unmatched positions.</p>
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Register holders</th>
                      <th className="r">Chain</th>
                      <th className="r">Register</th>
                      <th className="r">Difference</th>
                      <th>Chain status</th>
                      <th>Register status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.address}>
                        <td>
                          <Addr value={l.address} />
                        </td>
                        <td className="text-[13px]">{l.holderIds.join(", ") || <span className="text-muted">none</span>}</td>
                        <td className="r">
                          <Units value={l.chainUnits} />
                        </td>
                        <td className="r">
                          <Units value={l.registerUnits} />
                        </td>
                        <td className="r">
                          <Units value={l.difference} signed />
                        </td>
                        <td>{l.chainStatus && <StatusBadge status={l.chainStatus} />}</td>
                        <td>{l.registerStatus && <StatusBadge status={l.registerStatus} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <p className="num break-all text-xs text-muted">Register file sha256 {r.registerSha256}</p>
          </Section>
        </>
      )}
      <Registers asset={asset} files={registers} onChange={() => refresh()} />
    </div>
  );
}
