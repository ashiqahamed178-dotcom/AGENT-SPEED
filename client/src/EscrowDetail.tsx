import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage, formatAmount, STATUS_LABELS } from "./api";
import type { AgentRun, AskResult, Citation, Escrow, EscrowAction } from "./api";

type Props = {
  escrow: Escrow;
  onBack: () => void;
  onChange: (escrow: Escrow) => void;
  onRefresh: () => Promise<void>;
};

const ACTION_LABELS: Record<EscrowAction, string> = {
  fund: "Record funding",
  submit_evidence: "Submit delivery",
  start_review: "Start review",
  dispute: "Raise a dispute",
  release: "Release payment",
  refund: "Refund the buyer",
};

export function EscrowDetail({ escrow, onBack, onChange, onRefresh }: Props) {
  return (
    <>
      <button type="button" className="text-button back" onClick={onBack}>
        ← All escrows
      </button>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ESCROW</p>
            <h2 className="amount">{formatAmount(escrow.amount, escrow.currency)}</h2>
            <p className="muted">
              Buyer: {escrow.buyer.name} · Seller: {escrow.seller.name} · You are the{" "}
              {escrow.yourRoles.join(", ") || "viewer"}
            </p>
          </div>
          <span className={`status-pill ${escrow.status}`}>
            {STATUS_LABELS[escrow.status] ?? escrow.status}
          </span>
        </div>

        <Actions escrow={escrow} onChange={onChange} />
      </section>

      <div className="two-columns">
        <div className="column">
          <AgentPanel escrow={escrow} onChange={onChange} onRefresh={onRefresh} />
          <AskPanel escrow={escrow} />
        </div>

        <div className="column">
          <section className="panel">
            <p className="eyebrow">AGREEMENT</p>
            <p className="agreement-text">{escrow.agreementText || "No agreement text was provided."}</p>
            <p className="disclaimer hash">
              Fingerprint for the smart contract: <code>{escrow.agreementHash}</code>
            </p>
          </section>

          {escrow.evidence.length > 0 && (
            <section className="panel">
              <p className="eyebrow">DELIVERY EVIDENCE</p>
              {escrow.evidence.map((item) => (
                <div className="list-item" key={item.id}>
                  <strong>{item.submittedBy}</strong>
                  <p>{item.description}</p>
                  {item.referenceUrl && (
                    <a href={item.referenceUrl} target="_blank" rel="noreferrer noopener">
                      {item.referenceUrl}
                    </a>
                  )}
                </div>
              ))}
              <p className="disclaimer">Links are provided by the seller and aren't verified.</p>
            </section>
          )}

          <section className="panel">
            <p className="eyebrow">AUDIT TRAIL</p>
            <p className="muted">This history can't be edited, not even in the database.</p>
            {escrow.events.map((event) => (
              <div className="list-item" key={event.id}>
                <strong>{event.action.replaceAll("_", " ")}</strong>
                <small>
                  {event.actor} · {new Date(event.createdAt).toLocaleString()}
                </small>
                <p>{event.note}</p>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}

function Actions({ escrow, onChange }: { escrow: Escrow; onChange: (escrow: Escrow) => void }) {
  const [open, setOpen] = useState<"submit_evidence" | "dispute" | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const paths: Record<EscrowAction, string> = {
    fund: "fund",
    submit_evidence: "evidence",
    start_review: "review",
    dispute: "dispute",
    release: "release",
    refund: "refund",
  };

  async function run(action: EscrowAction, body: unknown = {}) {
    setBusy(true);
    setError("");

    try {
      onChange(await api<Escrow>(`/escrows/${escrow.id}/${paths[action]}`, body));
      setOpen(null);
      setText("");
      setUrl("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (open === "submit_evidence") {
      void run("submit_evidence", { description: text, referenceUrl: url || undefined });
    } else if (open === "dispute") {
      void run("dispute", { reason: text });
    }
  }

  if (escrow.availableActions.length === 0) {
    return <p className="muted action-note">No action is needed from you right now.</p>;
  }

  return (
    <div className="actions">
      <div className="action-buttons">
        {escrow.availableActions.map((action) => (
          <button
            type="button"
            key={action}
            className={action === "dispute" || action === "refund" ? "secondary" : "primary fit"}
            disabled={busy}
            onClick={() => {
              if (action === "submit_evidence" || action === "dispute") {
                setOpen(open === action ? null : action);
              } else {
                void run(action);
              }
            }}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>

      {open && (
        <form onSubmit={submitDetails}>
          <label>
            {open === "dispute" ? "Why are you raising a dispute?" : "What did you deliver?"}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              minLength={10}
              maxLength={open === "dispute" ? 1000 : 2000}
              required
            />
          </label>
          {open === "submit_evidence" && (
            <label>
              Link to the work (optional)
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://"
              />
            </label>
          )}
          <button type="submit" className="primary fit" disabled={busy}>
            {busy ? "Saving..." : "Confirm"}
          </button>
        </form>
      )}

      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  return (
    <div className="citations">
      <p className="label">Sources, checked against the agreement</p>
      {citations.map((citation, index) => (
        <details key={`${citation.clauseId}-${index}`}>
          <summary>
            <span className="clause-id">{citation.clauseId}</span> “{citation.quote}”
          </summary>
          <p>{citation.clauseText}</p>
        </details>
      ))}
    </div>
  );
}

function AskPanel({ escrow }: { escrow: Escrow }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);

    try {
      setResult(await api<AskResult>(`/escrows/${escrow.id}/ask`, { question }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <p className="eyebrow">ASK THE AGREEMENT</p>
      <h3>Answers with sources</h3>

      <form onSubmit={ask}>
        <label>
          Your question
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What happens if the seller misses the deadline?"
            minLength={5}
            maxLength={500}
            required
          />
        </label>
        <button type="submit" className="primary fit" disabled={busy}>
          {busy ? "Searching the agreement..." : "Ask"}
        </button>
      </form>

      {error && <p className="notice error" role="alert">{error}</p>}

      {result && (
        <div className="result">
          <p className={result.answerable ? "answer" : "answer refused"}>{result.answer}</p>
          <Citations citations={result.citations} />
          {result.rejectedCitations > 0 && (
            <p className="disclaimer">
              {result.rejectedCitations} citation(s) from the AI were blocked because they didn't match
              the agreement.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function AgentPanel({ escrow, onChange, onRefresh }: Omit<Props, "onBack">) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const base = `/escrows/${escrow.id}/agent-runs`;

  const watch = useCallback(
    function check(runId: string) {
      timer.current = window.setTimeout(async () => {
        try {
          const latest = await api<AgentRun>(`${base}/${runId}`);
          setRun(latest);
          if (latest.status === "running") check(runId);
        } catch (caught) {
          setError(errorMessage(caught));
        }
      }, 3000);
    },
    [base]
  );

  useEffect(() => {
    let cancelled = false;

    api<AgentRun[]>(base)
      .then((runs) => {
        const latest = runs[0];
        if (cancelled || !latest) return;
        setRun(latest);
        if (latest.status === "running") watch(latest.id);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
  }, [base, watch]);

  async function start() {
    setBusy(true);
    setError("");

    try {
      const started = await api<AgentRun>(base, {});
      setRun(started);
      watch(started.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "decline") {
    if (!run) return;
    setBusy(true);
    setError("");

    try {
      if (decision === "approve") {
        onChange(await api<Escrow>(`${base}/${run.id}/approve`, {}));
      } else {
        await api(`${base}/${run.id}/decline`, {});
      }
      setRun(await api<AgentRun>(`${base}/${run.id}`));
    } catch (caught) {
      setError(errorMessage(caught));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const running = run?.status === "running";

  return (
    <section className="panel agent-panel">
      <p className="eyebrow">AI REVIEW AGENT</p>
      <h3>Get a recommendation</h3>
      <p className="muted">
        The agent reads the agreement and evidence, then proposes one action. Nothing happens
        unless you approve it.
      </p>

      <button type="button" className="primary fit" disabled={busy || running} onClick={() => void start()}>
        {running ? "Reviewing, this can take a few minutes..." : run ? "Review again" : "Start review"}
      </button>

      {error && <p className="notice error" role="alert">{error}</p>}

      {run && !running && (
        <div className="result">
          {run.status === "failed" && <p className="notice error">{run.error}</p>}

          {run.proposedAction && (
            <p className="proposal">
              Proposal:{" "}
              <strong>
                {run.proposedAction === "none"
                  ? "No action"
                  : ACTION_LABELS[run.proposedAction]}
              </strong>
            </p>
          )}

          {run.blockedBy && (
            <p className="notice warning">The safety checks changed this proposal: {run.blockedBy}</p>
          )}

          {run.reasoning && <p>{run.reasoning}</p>}

          {run.risks.length > 0 && (
            <ul>
              {run.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          )}

          <Citations citations={run.citations} />

          {run.status === "pending_approval" && (
            <div className="action-buttons">
              <button type="button" className="primary fit" disabled={busy} onClick={() => void decide("approve")}>
                Approve and {run.proposedAction}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void decide("decline")}>
                Decline
              </button>
            </div>
          )}

          {run.status === "approved" && <p className="notice">You approved this proposal.</p>}
          {run.status === "declined" && <p className="notice">This proposal was declined.</p>}

          {run.trace.length > 0 && (
            <details className="trace">
              <summary>What the agent did</summary>
              <ol>
                {run.trace.map((step, index) => (
                  <li key={index}>
                    <strong>{step.step.replaceAll("_", " ")}:</strong> {step.detail}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
