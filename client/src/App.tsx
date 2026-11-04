import { useEffect, useState } from "react";
import "./App.css";
import { api } from "./api";
import type { AiInfo, User } from "./api";
import { AuthScreen } from "./AuthScreen";
import { EscrowsPage } from "./EscrowsPage";
import { PolicyPage } from "./PolicyPage";

type Page = "escrows" | "tools";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
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
  const [page, setPage] = useState<Page>("escrows");
  const [ai, setAi] = useState<AiInfo | null>(null);

  useEffect(() => {
    api<{ ai: AiInfo }>("/health")
      .then((health) => setAi(health.ai))
      .catch(() => setAi(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark">A</div>
        <div className="brand-copy">
          <h1>AgentSpend</h1>
          <p>AI-assisted escrow with human approval</p>
        </div>
        <span className="demo-badge">TEST MODE</span>
        <span className="user-name">
          {user.name}
          {user.role === "arbiter" ? " · Arbiter" : ""}
        </span>
        <button type="button" className="text-button" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={page === "escrows" ? "tab active" : "tab"}
          onClick={() => setPage("escrows")}
        >
          Escrows
        </button>
        <button
          type="button"
          className={page === "tools" ? "tab active" : "tab"}
          onClick={() => setPage("tools")}
        >
          Agreement and spending tools
        </button>
      </nav>

      {page === "escrows" ? <EscrowsPage user={user} /> : <PolicyPage ai={ai} />}

      <footer>
        <span>AgentSpend © 2026</span>
        <span>
          {ai ? `AI: ${ai.model} (${ai.provider === "ollama" ? "local" : "cloud"})` : "AI status unknown"}
          {" · "}Portfolio prototype, no real funds
        </span>
      </footer>
    </main>
  );
}
