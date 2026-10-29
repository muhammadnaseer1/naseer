"use client";
import { useEffect, useState } from "react";
type Stats = {
  active: number;
  generated: number;
  messages: number;
  storage: number;
  expired: number;
  errors: number;
  abuse: number;
  delivered: number;
  ttlHours: number;
  maxMessageBytes: number;
  inboxes: { id: string; emailAddress: string; expiresAt: string }[];
};
export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [ttl, setTtl] = useState(24),
    [max, setMax] = useState(10485760);
  async function request(path: string, method = "GET", data?: unknown) {
    const r = await fetch("/api/admin/" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }
  async function load() {
    try {
      const d = await request("stats");
      setStats(d);
      setTtl(d.ttlHours);
      setMax(d.maxMessageBytes);
      setError("");
    } catch {
      setStats(null);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="admin-shell">
      <a href="/" className="text-button">
        ← Back to FlashMail
      </a>
      <h1>Operations dashboard</h1>
      <p>
        Receive-only infrastructure. Private message contents are never shown
        here.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {!stats ? (
        <form
          className="admin-card"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await request("login", "POST", { password });
              setPassword("");
              await load();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label htmlFor="password">Administrator password</label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button className="primary">Sign in</button>
          <p>Access is disabled until ADMIN_PASSWORD_HASH is configured.</p>
        </form>
      ) : (
        <>
          <div className="admin-stats">
            {Object.entries({
              Generated: stats.generated,
              Active: stats.active,
              Expired: stats.expired,
              "Stored messages": stats.messages,
              "Delivered (all time)": stats.delivered,
              "Attachment bytes": stats.storage,
              "Webhook errors": stats.errors,
              "Rate-limit blocks": stats.abuse,
            }).map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <form
            className="admin-card"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await request("settings", "POST", {
                  ttlHours: ttl,
                  maxMessageBytes: max,
                });
                setError(
                  "Settings saved. Expiration changes apply to new inboxes.",
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <h2>Inbox limits</h2>
            <label>
              Expiration (hours)
              <input
                aria-label="Expiration hours"
                type="number"
                min="1"
                max="168"
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
              />
            </label>
            <label>
              Maximum message bytes
              <input
                aria-label="Maximum message bytes"
                type="number"
                min="1024"
                max="10485760"
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
              />
            </label>
            <button className="primary">Save limits</button>
          </form>
          <div className="admin-card">
            <h2>Latest inboxes</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Expires</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {stats.inboxes.map((b) => (
                  <tr key={b.id}>
                    <td>{b.emailAddress}</td>
                    <td>{new Date(b.expiresAt).toLocaleString()}</td>
                    <td>
                      <button
                        onClick={async () => {
                          if (
                            confirm(
                              "Delete this inbox and all associated data?",
                            )
                          )
                            try {
                              await request("inboxes/" + b.id, "DELETE");
                              await load();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="primary"
            onClick={async () => {
              await request("logout", "POST");
              setStats(null);
            }}
          >
            Sign out
          </button>
        </>
      )}
    </main>
  );
}
