
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

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

const API = "http://localhost:4000/api";

export default function App() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [agentName, setAgentName] = useState("Research Agent");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("25");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadPayments() {
    try {
      const response = await fetch(`${API}/payments`);
      if (!response.ok) throw new Error("Could not load payments");
      setPayments(await response.json());
    } catch {
      setMessage("Cannot connect to the API. Check that port 4000 is running.");
    }
  }

  useEffect(() => {
    void loadPayments();
  }, []);

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(`${API}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName,
          recipient,
          amount: Number(amount),
          reason,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Payment request failed");
      }

      setPayments((current) => [result, ...current]);
      setMessage(`Request ${result.status}: ${result.explanation}`);
      setRecipient("");
      setReason("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong"
      );
    } finally {
      setBusy(false);
    }
  }

  const approvedCount = payments.filter(
    (payment) => payment.status === "approved"
  ).length;

  const rejectedCount = payments.length - approvedCount;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark">A</div>
        <div className="brand-copy">
          <h1>AgentSpend</h1>
          <p>AI agent payment control</p>
        </div>
        <span className="demo-badge">TEST MODE</span>
      </header>

      <section className="hero">
        <p className="eyebrow">PAYMENT POLICY CONSOLE</p>
        <h2>Every payment deserves a decision.</h2>
        <p>
          Set a request, evaluate spending rules, and inspect the decision.
          A clear control layer for AI agent spending.
        </p>
      </section>

      <section className="stats">
        <article className="stat-card">
          <span>Total requests</span>
          <strong>{payments.length}</strong>
        </article>
        <article className="stat-card">
          <span>Approved</span>
          <strong className="approved-number">{approvedCount}</strong>
        </article>
        <article className="stat-card">
          <span>Rejected</span>
          <strong className="rejected-number">{rejectedCount}</strong>
        </article>
      </section>

      <section className="content-grid">
        <form className="panel" onSubmit={submitPayment}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">NEW REQUEST</p>
              <h3>Evaluate a payment</h3>
            </div>
            <span className="step-number">01</span>
          </div>

          <p className="muted">
            Demo rule: requests up to 100 USDC are approved.
          </p>

          <label>
            Agent name
            <input
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              maxLength={60}
              required
            />
          </label>

          <label>
            Recipient
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="e.g. Research API vendor"
              maxLength={100}
              required
            />
          </label>

          <label>
            Amount (demo USDC)
            <input
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              min="0.01"
              max="1000000"
              step="0.01"
              required
            />
          </label>

          <label>
            Business justification
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why does the agent need this payment?"
              maxLength={300}
              required
            />
          </label>

          <button type="submit" disabled={busy}>
            {busy ? "Evaluating..." : "Evaluate payment →"}
          </button>

          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}

          <p className="disclaimer">
            Prototype only. No funds are transferred.
          </p>
        </form>

        <section className="panel history-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AUDIT TRAIL</p>
              <h3>Decision history</h3>
            </div>
            <span className="step-number">02</span>
          </div>

          <p className="muted">
            Review payment requests and their policy decisions.
          </p>

          {payments.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">↗</div>
              <strong>No requests yet</strong>
              <p>Submit your first payment request to see it here.</p>
            </div>
          ) : (
            <div className="payment-list">
              {payments.map((payment) => (
                <article className="payment" key={payment.id}>
                  <div className="payment-heading">
                    <div className="recipient-info">
                      <strong>{payment.recipient}</strong>
                      <small>{payment.agentName}</small>
                    </div>
                    <span className={`status ${payment.status}`}>
                      <span className="status-dot" />
                      {payment.status}
                    </span>
                  </div>

                  <div className="payment-amount">
                    {payment.amount.toLocaleString()}{" "}
                    <span>demo USDC</span>
                  </div>

                  <p className="payment-reason">{payment.reason}</p>
                  <p className="explanation">{payment.explanation}</p>
                  <small className="timestamp">
                    {new Date(payment.createdAt).toLocaleString()}
                  </small>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <footer>
        <span>AgentSpend © 2026</span>
        <span>Portfolio prototype · No real funds</span>
      </footer>
    </main>
  );
}
