import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage, formatAmount, STATUS_LABELS } from "./api";
import type { Escrow, User } from "./api";
import { EscrowDetail } from "./EscrowDetail";

export function EscrowsPage({ user }: { user: User }) {
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setEscrows(await api<Escrow[]>("/escrows"));
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoaded(true);
    }
  }, []);

  // The other party can act at any time, so keep the page up to date.
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  // A newly opened page starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [selectedId]);

  const selected = escrows.find((escrow) => escrow.id === selectedId);

  if (selected) {
    return (
      <EscrowDetail
        key={selected.id}
        escrow={selected}
        onBack={() => setSelectedId(null)}
        onChange={(updated) =>
          setEscrows((current) =>
            current.map((escrow) => (escrow.id === updated.id ? updated : escrow))
          )
        }
        onRefresh={refresh}
      />
    );
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">YOUR TRANSACTIONS</p>
          <h2>Every payment deserves a decision.</h2>
          <p className="muted">
            {user.role === "arbiter"
              ? "Escrows you are part of, and disputes waiting for an arbiter."
              : "Escrows where you are the buyer or the seller."}
          </p>
        </div>
        <button type="button" className="primary fit" onClick={() => setCreating((open) => !open)}>
          {creating ? "Close" : "New escrow"}
        </button>
      </section>

      {creating && (
        <CreateEscrowForm
          onCreated={(escrow) => {
            setEscrows((current) => [escrow, ...current]);
            setCreating(false);
            setSelectedId(escrow.id);
          }}
        />
      )}

      {error && <p className="notice error" role="alert">{error}</p>}

      {loaded && escrows.length === 0 && !error && (
        <section className="panel empty">
          <strong>No escrows yet</strong>
          <p className="muted">Create one to get started. The seller needs an account first.</p>
        </section>
      )}

      <section className="escrow-list">
        {escrows.map((escrow) => (
          <button
            type="button"
            className="escrow-row"
            key={escrow.id}
            onClick={() => setSelectedId(escrow.id)}
          >
            <span className="escrow-row-main">
              <strong>
                {escrow.buyer.name} → {escrow.seller.name}
              </strong>
              <small>
                You are the {escrow.yourRoles.join(", ") || "viewer"}
                {escrow.availableActions.length > 0 ? " · Action needed" : ""}
              </small>
            </span>
            <span className="escrow-row-amount">{formatAmount(escrow.amount, escrow.currency)}</span>
            <span className={`status-pill ${escrow.status}`}>
              {STATUS_LABELS[escrow.status] ?? escrow.status}
            </span>
          </button>
        ))}
      </section>
    </>
  );
}

function CreateEscrowForm({ onCreated }: { onCreated: (escrow: Escrow) => void }) {
  const [sellerEmail, setSellerEmail] = useState("");
  const [amount, setAmount] = useState("250");
  const [currency, setCurrency] = useState("USDC");
  const [agreementText, setAgreementText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      onCreated(
        await api<Escrow>("/escrows", {
          sellerEmail,
          amount: Number(amount),
          currency,
          agreementText,
        })
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <p className="eyebrow">NEW ESCROW</p>
      <h3>You will be the buyer</h3>

      <label>
        Seller's email
        <input
          type="email"
          value={sellerEmail}
          onChange={(event) => setSellerEmail(event.target.value)}
          placeholder="The seller must have an account"
          required
        />
      </label>

      <div className="form-row">
        <label>
          Amount
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
          Currency
          <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option>USDC</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
        </label>
      </div>

      <label>
        Agreement
        <textarea
          className="tall"
          value={agreementText}
          onChange={(event) => setAgreementText(event.target.value)}
          placeholder="Include what will be delivered, the deadline, and when payment is released."
          maxLength={15000}
        />
      </label>

      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Creating..." : "Create escrow"}
      </button>

      {error && <p className="notice error" role="alert">{error}</p>}
      <p className="disclaimer">Prototype only. No funds are transferred.</p>
    </form>
  );
}
