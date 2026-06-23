"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) throw new Error(payload.error ?? "Sign in failed.");

      router.replace("/cad");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-visual">
          <div className="login-mark">DX</div>
          <div>
            <p className="eyebrow">Secure CAD Workspace</p>
            <h1>DXF 3D Preview Engine</h1>
            <p className="login-copy">Authenticated access for file conversion, quantity extraction, and 3D inspection.</p>
          </div>
        </div>

        <form className="login-panel" onSubmit={signIn}>
          <div className="panel-header">
            <div>
              <h2>Sign In</h2>
              <p>Enter the workspace password</p>
            </div>
          </div>

          <label className="field">
            <span>Password</span>
            <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>

          <button className="primary-button" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Continue"}
          </button>

          {error ? <div className="alert alert-error">{error}</div> : null}
        </form>
      </section>
    </main>
  );
}
