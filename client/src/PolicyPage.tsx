import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "./api";
import type { AiInfo } from "./api";

type Payment = {
  id: string;
  agentName: string;
  recipient: string;
  amount: number;
  reason: string;
  status: "approved" | "rejected";
  explanation: string;
  createdAt: string;
};

type Analysis = {
  summary: string;
  buyer: string;
  seller: string;
  amount: string;
  currency: string;
  deadline: string;
  deliverables: string[];
  paymentConditions: string[];
  risks: string[];
  missingInformation: string[];
  recommendation: "release" | "refund" | "dispute" | "review";
  reasoning: string;
};

export function PolicyPage({ ai }: { ai: AiInfo | null }) {
  return (
    <>
      <AgreementAnalyzer ai={ai} />
      <SpendingPolicy />
    </>
  );
}

function AgreementAnalyzer({ ai }: { ai: AiInfo | null }) {
  const [agreementText, setAgreementText] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setAnalysis(null);

    try {
      const result = await api<{ analysis: Analysis }>("/ai/analyze-agreement", { agreementText });
      setAnalysis(result.analysis);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{ai ? `POWERED BY ${ai.model.toUpperCase()}` : "AI ANALYSIS"}</p>
          <h3>Agreement analyzer</h3>
          <p className="muted">Paste an agreement to extract its terms, obligations and risks.</p>
        </div>
        {ai && <span className="tag">{ai.provider === "ollama" ? "LOCAL AI" : "CLOUD AI"}</span>}
      </div>

      <form onSubmit={analyze}>
        <label>
          Agreement
          <textarea
            className="tall"
            value={agreementText}
            onChange={(event) => setAgreementText(event.target.value)}
            placeholder="Include the buyer, seller, amount, deadline, deliverables and payment conditions."
            minLength={30}
            maxLength={15000}
            required
          />
        </label>

        <div className="split-row">
          <span className="muted">{agreementText.length}/15000 characters</span>
          <button type="submit" className="primary fit" disabled={busy || agreementText.trim().length < 30}>
            {busy ? "Analysing, this can take a minute..." : "Analyse with AI"}
          </button>
        </div>
      </form>

      {error && <p className="notice error" role="alert">{error}</p>}

      {analysis && (
        <div className="result">
          <div className="panel-heading">
            <h3>{analysis.summary}</h3>
            <span className="tag">{analysis.recommendation.toUpperCase()}</span>
          </div>

          <div className="facts">
            <Fact label="Buyer" value={analysis.buyer} />
            <Fact label="Seller" value={analysis.seller} />
            <Fact label="Amount" value={analysis.amount} />
            <Fact label="Currency" value={analysis.currency} />
            <Fact label="Deadline" value={analysis.deadline} />
          </div>

          <div className="fact-lists">
            <FactList title="Deliverables" items={analysis.deliverables} />
            <FactList title="Payment conditions" items={analysis.paymentConditions} />
            <FactList title="Potential risks" items={analysis.risks} />
            <FactList title="Missing information" items={analysis.missingInformation} />
          </div>

          <div className="fact-box">
            <h4>AI reasoning</h4>
            <p>{analysis.reasoning}</p>
          </div>

          <p className="disclaimer">
            AI-generated assessment only. Verify the agreement and evidence. This analysis doesn't
            authorize or execute a payment.
          </p>
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact-box">
      <span className="label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FactList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="fact-box">
      <h4>{title}</h4>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">None listed.</p>
      )}
    </div>
  );
}

function SpendingPolicy() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [agentName, setAgentName] = useState("Research Agent");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("25");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPayments(await api<Payment[]>("/payments"));
    } catch (caught) {
      setMessage(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const result = await api<Payment>("/payments", {
        agentName,
        recipient,
        amount: Number(amount),
        reason,
      });
      setPayments((current) => [result, ...current]);
      setMessage(`Request ${result.status}: ${result.explanation}`);
      setRecipient("");
      setReason("");
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const approved = payments.filter((payment) => payment.status === "approved").length;

  return (
    <>
      <section className="stats">
        <article className="panel stat">
          <span className="label">Agent spending requests</span>
          <strong>{payments.length}</strong>
        </article>
        <article className="panel stat">
          <span className="label">Approved</span>
          <strong className="good">{approved}</strong>
        </article>
        <article className="panel stat">
          <span className="label">Rejected</span>
          <strong className="bad">{payments.length - approved}</strong>
        </article>
      </section>

      <div className="two-columns">
        <form className="panel" onSubmit={submit}>
          <p className="eyebrow">SPENDING POLICY</p>
          <h3>Test an agent's payment request</h3>
          <p className="muted">A fixed code rule approves requests up to 100 USDC. No AI decides this.</p>

          <label>
            Agent name
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} maxLength={60} required />
          </label>
          <label>
            Recipient
            <input value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={100} required />
          </label>
          <label>
            Amount (demo USDC)
            <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} min="0.01" max="1000000" step="0.01" required />
          </label>
          <label>
            Business reason
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} required />
          </label>

          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Evaluating..." : "Evaluate request"}
          </button>

          {message && <p className="notice" role="status">{message}</p>}
        </form>

        <section className="panel">
          <p className="eyebrow">DECISION HISTORY</p>
          {payments.length === 0 && <p className="muted">No requests yet.</p>}
          {payments.map((payment) => (
            <div className="list-item" key={payment.id}>
              <div className="split-row">
                <strong>{payment.recipient}</strong>
                <span className={payment.status === "approved" ? "good" : "bad"}>{payment.status}</span>
              </div>
              <small>
                {payment.agentName} · {payment.amount.toLocaleString()} demo USDC ·{" "}
                {new Date(payment.createdAt).toLocaleString()}
              </small>
              <p>{payment.reason}</p>
              <p className="muted">{payment.explanation}</p>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
