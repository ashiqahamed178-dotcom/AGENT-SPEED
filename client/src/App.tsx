import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { AuthScreen } from "./AuthScreen";
import type { User } from "./AuthScreen";

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

const API = "/api";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch(`${API}/auth/me`)
      .then((response) => (response.ok ? response.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) return null;
  if (!user) return <AuthScreen onLogin={setUser} />;

  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [agentName, setAgentName] = useState("Research Agent");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("25");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [agreementText, setAgreementText] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  async function loadPayments() {
    try {
      const response = await fetch(`${API}/payments`);
      if (!response.ok) throw new Error("Could not load payments");
      setPayments(await response.json());
    } catch {
      setMessage("Cannot connect to API. Check that port 4000 is running.");
    }
  }

  useEffect(() => {
    void loadPayments();
  }, []);

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST" });
    onLogout();
  }

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
      if (!response.ok) throw new Error(result.error ?? "Payment request failed");

      setPayments((current) => [result, ...current]);
      setMessage(`Request ${result.status}: ${result.explanation}`);
      setRecipient("");
      setReason("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeAgreement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiBusy(true);
    setAiError("");
    setAnalysis(null);

    try {
      const response = await fetch(`${API}/ai/analyze-agreement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreementText }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Agreement analysis failed");
      }

      setAnalysis(result.analysis);
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : "Could not analyse agreement"
      );
    } finally {
      setAiBusy(false);
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
          <p>AI-powered escrow intelligence</p>
        </div>
        <span className="demo-badge">TEST MODE</span>
        <span className="user-name">{user.name}</span>
        <button type="button" className="link-button logout-button" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <section className="hero">
        <p className="eyebrow">INTELLIGENT PAYMENT CONTROL</p>
        <h2>Every payment deserves a decision.</h2>
        <p>
          Analyse agreements, understand payment conditions and evaluate
          spending requests with your local AI model.
        </p>
      </section>

      <section className="ai-section">
        <div className="ai-heading">
          <div>
            <p className="eyebrow">POWERED BY LLAMA 3.2</p>
            <h3>AI Escrow Agreement Analyzer</h3>
            <p className="muted">
              Paste an agreement to extract its terms, obligations and risks.
            </p>
          </div>
          <span className="ai-indicator">LOCAL AI</span>
        </div>

        <form onSubmit={analyzeAgreement}>
          <label>
            Escrow agreement
            <textarea
              className="agreement-input"
              value={agreementText}
              onChange={(event) => setAgreementText(event.target.value)}
              placeholder="Paste your agreement here. Include buyer, seller, amount, deadline, deliverables and payment conditions..."
              minLength={30}
              maxLength={15000}
              required
            />
          </label>

          <div className="ai-actions">
            <span className="muted">{agreementText.length}/15000 characters</span>
            <button type="submit" disabled={aiBusy || agreementText.trim().length < 30}>
              {aiBusy ? "Analysing agreement..." : "Analyse with AI"}
            </button>
          </div>
        </form>

        {aiError && <p className="notice error-notice">{aiError}</p>}

        {analysis && (
          <div className="analysis-results">
            <div className="analysis-title">
              <div>
                <p className="eyebrow">AI ANALYSIS REPORT</p>
                <h3>Agreement overview</h3>
              </div>
              <span style={{ color: "#000000", background: "transparent", border: "none", boxShadow: "none", padding: 0, fontWeight: 800 }}>
                {analysis.recommendation.toUpperCase()}
              </span>
            </div>

            <p className="analysis-summary">{analysis.summary}</p>

            <div className="analysis-facts">
              <article><span>Buyer</span><strong>{analysis.buyer}</strong></article>
              <article><span>Seller</span><strong>{analysis.seller}</strong></article>
              <article><span>Amount</span><strong>{analysis.amount}</strong></article>
              <article><span>Currency</span><strong>{analysis.currency}</strong></article>
              <article><span>Deadline</span><strong>{analysis.deadline}</strong></article>
            </div>

            <div className="analysis-columns">
              <section>
                <h4>Deliverables</h4>
                <ul>{analysis.deliverables.map((item, i) => <li key={i}>{item}</li>)}</ul>
              </section>
              <section>
                <h4>Payment conditions</h4>
                <ul>{analysis.paymentConditions.map((item, i) => <li key={i}>{item}</li>)}</ul>
              </section>
              <section>
                <h4>Potential risks</h4>
                <ul>{analysis.risks.map((item, i) => <li key={i}>{item}</li>)}</ul>
              </section>
              <section>
                <h4>Missing information</h4>
                <ul>{analysis.missingInformation.map((item, i) => <li key={i}>{item}</li>)}</ul>
              </section>
            </div>

            <div className="reasoning">
              <h4>AI reasoning</h4>
              <p>{analysis.reasoning}</p>
            </div>

            <p className="disclaimer">
              AI-generated assessment only. Verify the agreement and evidence.
              This analysis does not authorize or execute a payment.
            </p>
          </div>
        )}
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
            <input value={agentName} onChange={(e) => setAgentName(e.target.value)} maxLength={60} required />
          </label>

          <label>
            Recipient
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="e.g. Research API vendor" maxLength={100} required />
          </label>

          <label>
            Amount (demo USDC)
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="0.01" max="1000000" step="0.01" required />
          </label>

          <label>
            Business justification
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does the agent need this payment?" maxLength={300} required />
          </label>

          <button type="submit" disabled={busy}>
            {busy ? "Evaluating..." : "Evaluate payment"}
          </button>

          {message && <p className="notice" role="status">{message}</p>}

          <p className="disclaimer">Prototype only. No funds are transferred.</p>
        </form>

        <section className="panel history-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AUDIT TRAIL</p>
              <h3>Decision history</h3>
            </div>
            <span className="step-number">02</span>
          </div>

          <p className="muted">Review payment requests and their policy decisions.</p>

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
                    {payment.amount.toLocaleString()} <span>demo USDC</span>
                  </div>
                  <p className="payment-reason">{payment.reason}</p>
                  <p className="explanation">{payment.explanation}</p>
                  <small className="timestamp">{new Date(payment.createdAt).toLocaleString()}</small>
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

