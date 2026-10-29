"use client";
import { faq } from "@/lib/faq";
import { useCallback, useEffect, useState } from "react";
import {
  Zap,
  Copy,
  RefreshCw,
  ArrowUpRight,
  ChevronDown,
  ShieldCheck,
  Clock,
  Inbox,
  Lock,
  Mail,
  Sun,
  Moon,
  Check,
  Trash2,
  ArrowLeft,
  Download,
  Globe,
  Plus,
  CheckCheck,
  Menu,
  X,
} from "lucide-react";
type Box = { id: string; emailAddress: string; expiresAt: string };
type Message = {
  id: string;
  sender: string;
  subject: string;
  preview: string;
  receivedAt: string;
  isRead: boolean;
  textBody?: string;
  sanitizedHtmlBody?: string;
  attachments?: { id: string; filename: string; fileSize: number }[];
};

async function api(path: string, method = "GET") {
  const r = await fetch("/api/" + path, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
export default function Home() {
  const [box, setBox] = useState<Box | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [selected, setSelected] = useState<Message | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(true),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [remaining, setRemaining] = useState("24:00:00"),
    [dark, setDark] = useState(false),
    [tab, setTab] = useState("all"),
    [html, setHtml] = useState(false),
    [menu, setMenu] = useState(false),
    [connected, setConnected] = useState(false);
  const toast = (s: string) => {
    setNotice(s);
    setTimeout(() => setNotice(""), 3500);
  };
  const refresh = useCallback(async () => {
    try {
      const d = await api("inbox/messages");
      setMessages(d.messages);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const initialize = useCallback(async () => {
    setBusy(true);
    try {
      let d;
      try {
        d = await api("inbox/current");
      } catch {
        d = await api("inbox/create", "POST");
      }
      setBox(d.inbox);
      setReady(d.receivingConfigured);
      setError("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);
  useEffect(() => {
    void initialize();
    const theme = localStorage.getItem("flashmail-theme");
    if (theme === "dark") {
      setDark(true);
      document.documentElement.dataset.theme = "dark";
    }
  }, [initialize]);
  useEffect(() => {
    if (!box) return;
    const tick = () => {
      const secs = Math.max(
        0,
        Math.floor((new Date(box.expiresAt).getTime() - Date.now()) / 1000),
      );
      setRemaining(
        [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60]
          .map((n) => String(n).padStart(2, "0"))
          .join(":"),
      );
      if (!secs) setError("Your inbox has expired. Generate a new address.");
    };
    tick();
    const timer = setInterval(tick, 1000);
    const es = new EventSource("/api/inbox/events");
    es.addEventListener("ready", () => setConnected(true));
    es.addEventListener("message", () => {
      void refresh();
      toast("Your inbox has been updated");
    });
    es.onerror = () => setConnected(false);
    const polling = setInterval(() => void refresh(), 30000);
    return () => {
      clearInterval(timer);
      clearInterval(polling);
      es.close();
    };
  }, [box, refresh]);
  async function regenerate() {
    if (
      messages.length &&
      !confirm(
        "Replace your address? Your existing messages will be permanently deleted.",
      )
    )
      return;
    setBusy(true);
    try {
      const d = await api("inbox/regenerate", "POST");
      setBox(d.inbox);
      setMessages([]);
      setSelected(null);
      toast("A fresh inbox is ready");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(m: Message) {
    try {
      const d = await api("inbox/messages/" + m.id);
      setSelected(d);
      setHtml(false);
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function remove(id?: string) {
    if (
      !confirm(id ? "Delete this message?" : "Permanently delete all messages?")
    )
      return;
    try {
      await api("inbox/messages" + (id ? "/" + id : ""), "DELETE");
      setSelected(null);
      await refresh();
      toast(id ? "Message deleted" : "Inbox cleared");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const unread = messages.filter((m) => !m.isRead).length;
  return (
    <>
      <header className="header">
        <a className="brand" href="/" aria-label="FlashMail home">
          <span className="brand-icon">
            <Zap size={21} fill="currentColor" />
          </span>
          flash<span>mail</span>
          <span className="beta">BETA</span>
        </a>
        <nav className={menu ? "nav open" : "nav"}>
          <a href="#how-it-works">How it works</a>
          <a href="#why-flashmail">Why FlashMail</a>
          <a href="#faq">FAQs</a>
        </nav>
        <div className="header-right">
          <span className="private-label">
            <Lock size={13} /> Privacy comes first
          </span>
          <button
            className="icon-btn"
            aria-label="Toggle dark mode"
            onClick={() => {
              setDark(!dark);
              document.documentElement.dataset.theme = dark ? "light" : "dark";
              localStorage.setItem("flashmail-theme", dark ? "light" : "dark");
            }}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            className="mobile-menu icon-btn"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle navigation"
          >
            {menu ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="eyebrow">
            <span className="live-dot" /> A LITTLE PRIVACY GOES A LONG WAY
          </div>
          <h1>
            Your inbox.
            <br className="mobile-break" /> <span>Without the baggage.</span>
          </h1>
          <p className="hero-description">
            A fresh email address in seconds. Keep the spam out of your life,
            <br className="desktop-break" /> and your personal inbox just that —
            personal.
          </p>
          <div className="hero-badges">
            <span>
              <Check size={14} /> No sign-up
            </span>
            <span>
              <Check size={14} /> Completely free
            </span>
            <span>
              <Check size={14} /> Receive-only. Worry-free.
            </span>
          </div>
        </section>
        <section className="workspace" aria-label="Temporary email inbox">
          <div className="address-card">
            <div className="address-top">
              <span className="small-label">
                <span className="tiny-mail">
                  <Mail size={15} />
                </span>{" "}
                YOUR TEMPORARY EMAIL ADDRESS
              </span>
              <span className="session-tag">
                <ShieldCheck size={13} /> Private session
              </span>
            </div>
            <div className="address-row">
              <div className="address-text">
                {busy && !box ? (
                  <span className="shimmer">Creating your inbox…</span>
                ) : (
                  box?.emailAddress || "Your fresh inbox awaits"
                )}
              </div>
              <button
                className="copy-btn"
                disabled={!box}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(box!.emailAddress);
                    toast("Email address copied");
                  } catch {
                    toast("Copy unavailable. Select and copy your address.");
                  }
                }}
              >
                <Copy size={17} />
                <span>Copy address</span>
              </button>
            </div>
            <div className="address-bottom">
              <span className="expires">
                <Clock size={14} /> Expires in <strong>{remaining}</strong>
                <span className="expiry-desktop">
                  {" "}
                  · Auto-deletes for your privacy
                </span>
              </span>
              <button
                className="text-button"
                onClick={regenerate}
                disabled={busy}
              >
                <RefreshCw size={13} /> Change address
              </button>
            </div>
          </div>
          <div className="toolbar">
            <div className="toolbar-left">
              <span className="live-dot" />
              <span>
                {connected ? "Live updates on" : "Connecting live updates…"}
              </span>
              <span className="toolbar-separator">/</span>
              <span>Only you can access this inbox</span>
            </div>
            <div className="toolbar-actions">
              <button
                onClick={async () => {
                  await refresh();
                  toast("Inbox refreshed");
                }}
                disabled={!box}
              >
                <RefreshCw size={15} /> Refresh inbox
              </button>
              <button onClick={regenerate} disabled={busy}>
                <Plus size={16} /> New address
              </button>
            </div>
          </div>
          {!ready && (
            <div className="connection-notice">
              <Globe size={15} />
              <span>
                <strong>Domain not connected.</strong> Your private inbox is
                ready. External email delivery needs domain and provider setup.
              </span>
              <a href="#receiving">
                Setup details <ArrowUpRight size={13} />
              </a>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={initialize}>Try again</button>
            </div>
          )}
          <div className="inbox-card">
            <div className="inbox-heading">
              <div className="inbox-title">
                <Inbox size={20} />
                <h2>Inbox</h2>
                <span className="count">{messages.length}</span>
              </div>
              <div className="inbox-tools">
                <span className="auto-refresh">
                  <span className="live-dot" /> Auto-refreshing
                </span>
                <button
                  className="icon-btn"
                  aria-label="Delete all messages"
                  disabled={!messages.length}
                  onClick={() => remove()}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {selected ? (
              <div className="message-view">
                <button
                  className="text-button"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft size={15} /> Back to inbox
                </button>
                <h3>{selected.subject || "(No subject)"}</h3>
                <div className="message-meta">
                  <strong>{selected.sender}</strong>
                  <span>{new Date(selected.receivedAt).toLocaleString()}</span>
                </div>
                <div className="viewer-actions">
                  <button onClick={() => setHtml(!html)}>
                    {html ? "View plain text" : "View safe HTML"}
                  </button>
                  <button onClick={() => remove(selected.id)}>
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
                {html ? (
                  <iframe
                    title="Sanitized email content"
                    sandbox=""
                    srcDoc={
                      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><style>body{font:15px system-ui;line-height:1.7;color:#333;overflow-wrap:anywhere}</style>' +
                      selected.sanitizedHtmlBody
                    }
                  />
                ) : (
                  <pre className="message-body">
                    {selected.textBody || "No plain-text content."}
                  </pre>
                )}
                {selected.attachments?.map((a) => (
                  <a
                    className="attachment"
                    key={a.id}
                    href={
                      "/api/inbox/messages/" +
                      selected.id +
                      "/attachments/" +
                      a.id
                    }
                  >
                    <Download size={15} />
                    {a.filename}{" "}
                    <small>{Math.ceil(a.fileSize / 1024)} KB · Scanned</small>
                  </a>
                ))}
              </div>
            ) : (
              <>
                <div className="inbox-tabs">
                  <button
                    className={tab === "all" ? "active" : ""}
                    onClick={() => setTab("all")}
                  >
                    All messages <span>{messages.length}</span>
                  </button>
                  <button
                    className={tab === "unread" ? "active" : ""}
                    onClick={() => setTab("unread")}
                  >
                    Unread {unread > 0 && <span>{unread}</span>}
                  </button>
                  <span className="inbox-column-date">RECEIVED</span>
                </div>
                {busy ? (
                  <div className="empty">
                    <RefreshCw className="spin" size={28} />
                    <h3>Preparing your private inbox</h3>
                    <p>Just a moment. Good things come with privacy.</p>
                  </div>
                ) : messages.filter((m) => tab !== "unread" || !m.isRead)
                    .length ? (
                  <div className="message-list">
                    {messages
                      .filter((m) => tab !== "unread" || !m.isRead)
                      .map((m) => (
                        <button
                          className={
                            "message-row " + (!m.isRead ? "unread" : "")
                          }
                          key={m.id}
                          onClick={() => open(m)}
                        >
                          <span className="sender-avatar">
                            {m.sender.charAt(0).toUpperCase()}
                          </span>
                          <span className="message-summary">
                            <strong>{m.sender}</strong>
                            <b>{m.subject || "(No subject)"}</b>
                            <span>{m.preview}</span>
                          </span>
                          <time>
                            {new Date(m.receivedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          {!m.isRead && <span className="unread-dot" />}
                        </button>
                      ))}
                  </div>
                ) : (
                  <div className="empty">
                    <div className="empty-art">
                      <span className="orbit orbit-one" />
                      <span className="orbit orbit-two" />
                      <span className="art-star star-one">✦</span>
                      <span className="art-star star-two">+</span>
                      <div className="letter">
                        <div />
                        <div />
                        <div />
                      </div>
                      <div className="art-tray">
                        <Inbox size={43} strokeWidth={1.25} />
                      </div>
                      <span className="art-check">
                        <Check size={12} />
                      </span>
                    </div>
                    <h3>
                      {tab === "unread"
                        ? "All caught up. Nice."
                        : "A clean slate. Feels good, right?"}
                    </h3>
                    <p>
                      {tab === "unread"
                        ? "You have no unread messages."
                        : "Your incoming emails will appear here automatically."}
                      <br />
                      No spam. No clutter. Just what you need.
                    </p>
                    <span className="waiting">
                      <span className="live-dot" />{" "}
                      {ready
                        ? "Waiting for incoming emails"
                        : "Waiting for domain connection"}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="inbox-footer">
              <span>
                <Lock size={12} /> Secure. Anonymous. Yours.
              </span>
              <span>
                Messages disappear when your inbox expires <Clock size={12} />
              </span>
            </div>
          </div>
          <div className="under-inbox">
            <ShieldCheck size={14} />
            <span>
              No accounts. No personal details. Just a little more peace of
              mind.
            </span>
          </div>
        </section>
        <section className="how-section" id="how-it-works">
          <div className="section-kicker">LESS SPAM. MORE LIFE.</div>
          <h2>Privacy shouldn’t be complicated.</h2>
          <p>Three simple steps. One less thing to worry about.</p>
          <div className="steps">
            <article>
              <span className="step-icon">
                <Zap size={22} />
              </span>
              <small>01</small>
              <h3>A fresh address, instantly</h3>
              <p>
                Open FlashMail and your temporary email is ready. No forms, no
                passwords, no fuss.
              </p>
            </article>
            <article>
              <span className="step-icon">
                <Copy size={22} />
              </span>
              <small>02</small>
              <h3>Use it. Keep yours private.</h3>
              <p>
                Copy your address for sign-ups, downloads, or that one-time
                thing. Your real inbox stays yours.
              </p>
            </article>
            <article>
              <span className="step-icon">
                <Inbox size={23} />
              </span>
              <small>03</small>
              <h3>Receive it. Then leave it.</h3>
              <p>
                Your emails arrive right here. When time’s up, your inbox and
                everything in it disappear.
              </p>
            </article>
          </div>
        </section>
        <section className="benefit-banner" id="why-flashmail">
          <div className="benefit-mark">
            <ShieldCheck size={36} />
          </div>
          <div>
            <span className="section-kicker">BUILT FOR A QUIETER INTERNET</span>
            <h2>
              Your email is personal.
              <br />
              Let’s keep it that way.
            </h2>
            <p>
              Skip the spam lists and unwanted follow-ups. A disposable email
              <br className="desktop-break" /> gives you the freedom to explore
              with a little less exposure.
            </p>
          </div>
          <div className="benefit-points">
            <span>
              <CheckCheck size={18} /> No registration, ever
            </span>
            <span>
              <Lock size={18} /> Private browser sessions
            </span>
            <span>
              <Clock size={18} /> Automatically expires
            </span>
            <span>
              <ShieldCheck size={18} /> Tracking content blocked
            </span>
          </div>
        </section>
        <section className="faq-section" id="faq">
          <div>
            <span className="section-kicker">A FEW THINGS TO KNOW</span>
            <h2>
              Good questions.
              <br />
              Clear answers.
            </h2>
            <p>A little clarity for your temporary inbox.</p>
          </div>
          <div className="faq-list">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <ChevronDown size={17} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="receiving-note" id="receiving">
          <Globe size={21} />
          <div>
            <h3>Connecting a real email domain</h3>
            <p>
              External receiving requires your domain’s MX records, a Mailgun
              inbound route, HTTPS, and a webhook signing key. The included
              deployment guide explains each step. Delivery is not verified
              until an external email reaches your inbox.
            </p>
          </div>
          <span className={"status-pill " + (ready ? "configured" : "")}>
            {ready ? "Configured · verify delivery" : "Setup required"}
          </span>
        </section>
      </main>
      <footer>
        <a className="brand" href="/">
          <span className="brand-icon">
            <Zap size={17} fill="currentColor" />
          </span>
          flash<span>mail</span>
        </a>
        <p>A fresh inbox. A little more freedom.</p>
        <div>
          <a href="/privacy">Privacy policy</a>
          <a href="#faq">FAQs</a>
          <span>© {new Date().getFullYear()} FlashMail</span>
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </>
  );
}
