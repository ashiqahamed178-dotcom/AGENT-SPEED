import { useState } from "react";
import type { FormEvent } from "react";

export type User = {
  id: string;
  email: string;
  name: string;
  role: "user" | "arbiter";
};

export function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegister ? { email, name, password } : { email, password }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Something went wrong");
      }

      onLogin(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell auth-shell">
      <header className="topbar">
        <div className="brand-mark">A</div>
        <div className="brand-copy">
          <h1>AgentSpend</h1>
          <p>AI-powered escrow intelligence</p>
        </div>
        <span className="demo-badge">TEST MODE</span>
      </header>

      <form className="panel auth-panel" onSubmit={submit}>
        <p className="eyebrow">{isRegister ? "CREATE ACCOUNT" : "WELCOME BACK"}</p>
        <h3>{isRegister ? "Create your account" : "Log in"}</h3>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

        {isRegister && (
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={100}
              required
            />
          </label>
        )}

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={isRegister ? 10 : 1}
            maxLength={200}
            required
          />
        </label>

        <button type="submit" disabled={busy}>
          {busy ? "Please wait..." : isRegister ? "Create account" : "Log in"}
        </button>

        {error && (
          <p className="notice error-notice" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(isRegister ? "login" : "register");
            setError("");
          }}
        >
          {isRegister ? "Already have an account? Log in" : "New here? Create an account"}
        </button>

        <p className="disclaimer">Prototype only. No funds are transferred.</p>
      </form>
    </main>
  );
}
