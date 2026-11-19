import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IS_DESKTOP,
  SUBSCRIPTION_URL,
  connect,
  copyText,
  disconnect,
  getStatus,
  loadSnapshot,
  openRepository,
  testLatency,
  type Config,
  type Connection,
  type Snapshot,
} from "./api";

function Arrow() {
  return (
    <svg className="arrow" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 12 12 4M4 4h8v8" />
    </svg>
  );
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function ago(iso?: string | null): string {
  if (!iso) return "just now";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error:\s*/, "");
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<Connection | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [proto, setProto] = useState("all");
  const [measured, setMeasured] = useState<Record<string, number | null>>({});
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [copiedSub, setCopiedSub] = useState(false);
  const [copiedRow, setCopiedRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSnapshot(await loadSnapshot());
    } catch (error) {
      setLoadError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    getStatus()
      .then((current) => {
        if (current?.connected) {
          setStatus(current);
          setStartedAt(Date.now() - current.sinceMs);
        }
      })
      .catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const configs = snapshot?.configs ?? [];

  const protos = useMemo(
    () => ["all", ...Array.from(new Set(configs.map((config) => config.proto)))],
    [configs],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return configs.filter((config) => {
      if (proto !== "all" && config.proto !== proto) return false;
      if (!needle) return true;
      return `${config.host} ${config.port} ${config.remark ?? ""} ${config.proto}`
        .toLowerCase()
        .includes(needle);
    });
  }, [configs, proto, query]);

  const activeLink = status
    ? configs.find((config) => config.host === status.host && config.port === status.port)
        ?.link ?? null
    : null;

  const latency = (config: Config): string => {
    if (config.link in measured) {
      const value = measured[config.link];
      return value === null ? "—" : `${value} ms`;
    }
    return typeof config.ms === "number" ? `${Math.round(config.ms)} ms` : "—";
  };

  async function copySubscription() {
    if (!(await copyText(SUBSCRIPTION_URL))) {
      setNotice({
        kind: "error",
        text: "The clipboard is unavailable. Select the URL and copy it manually.",
      });
      return;
    }
    setCopiedSub(true);
    window.setTimeout(() => setCopiedSub(false), 1500);
  }

  async function copyLink(config: Config) {
    if (!(await copyText(config.link))) {
      setNotice({ kind: "error", text: "The clipboard is unavailable." });
      return;
    }
    setCopiedRow(config.link);
    window.setTimeout(() => setCopiedRow(null), 1200);
  }

  async function handleDisconnect() {
    try {
      await disconnect();
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    }
    setStatus(null);
    setStartedAt(0);
  }

  async function handleConnect(config: Config) {
    if (busy) return;
    setNotice(null);
    if (status && status.host === config.host && status.port === config.port) {
      await handleDisconnect();
      return;
    }
    setBusy(config.link);
    try {
      const next = await connect(config);
      setStatus(next);
      setStartedAt(Date.now() - next.sinceMs);
      if (next.note) setNotice({ kind: "info", text: next.note });
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    if (!IS_DESKTOP) {
      setNotice({ kind: "info", text: "Latency tests run in the desktop app." });
      return;
    }
    setTesting(true);
    setNotice(null);
    try {
      const results = await Promise.all(
        filtered.map(async (config) => {
          const value = await testLatency(config.host, config.port);
          return [config.link, value] as const;
        }),
      );
      setMeasured((previous) => {
        const next = { ...previous };
        for (const [link, value] of results) next[link] = value;
        return next;
      });
    } catch (error) {
      setNotice({ kind: "error", text: message(error) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="register-mark" aria-hidden="true" />
          v2all
        </div>
        <div className="topbar-actions">
          <button className="rowlink" type="button" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          <button className="rowlink" type="button" onClick={() => void openRepository()}>
            Read the source <Arrow />
          </button>
        </div>
      </header>

      {status ? (
        <div className="live" role="status" aria-live="polite">
          <span className="live-state">Connected</span>
          <span className="live-clock">{clock(now - startedAt)}</span>
          <span className="live-server">
            {status.remark || `${status.host}:${status.port}`}
          </span>
          <span className="live-proxy">HTTP 127.0.0.1:10809 · SOCKS 127.0.0.1:10808</span>
          <button className="live-off" type="button" onClick={() => void handleDisconnect()}>
            Disconnect
          </button>
        </div>
      ) : null}

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Live subscription · rebuilt every 6 hours</p>
            <h1>
              {loading ? "Loading" : `${configs.length} configs`}
              <br />
              {loading ? "the list." : "that proxy."}
            </h1>
            <p className="hero-note">
              Every entry completed a real Xray handshake in the last CI run. TCP-open
              alone doesn&rsquo;t make the cut.
            </p>
            {snapshot?.stats ? (
              <p className="eyebrow hero-stats">
                {snapshot.stats.sources} sources ·{" "}
                {snapshot.stats.raw.toLocaleString()} scanned ·{" "}
                {snapshot.stats.real_alive} passed
              </p>
            ) : null}
          </div>

          <div className="subscription">
            <p className="eyebrow">Subscription URL</p>
            <div className="subscription-row">
              <code>{SUBSCRIPTION_URL}</code>
              <button className="btn" type="button" onClick={() => void copySubscription()}>
                {copiedSub ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="hint">
              Add it in v2rayNG, Hiddify, or v2rayN — or connect from the list below.
            </p>
          </div>
        </section>

        {notice ? (
          <p
            className={`notice notice--${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        ) : null}

        <section className="list" aria-label="Working configs">
          <div className="toolbar">
            <input
              className="search"
              type="search"
              placeholder="Search host or remark…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search configs"
            />
            <div className="chips" role="group" aria-label="Filter by protocol">
              {protos.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="chip"
                  aria-pressed={proto === item}
                  onClick={() => setProto(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <button
              className="ghost"
              type="button"
              onClick={() => void handleTest()}
              disabled={testing || !filtered.length}
            >
              {testing ? "Testing…" : "Test latency"}
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-num">#</th>
                  <th className="col-proto">Proto</th>
                  <th>Server</th>
                  <th>Remark</th>
                  <th className="col-lat">Latency</th>
                  <th className="col-act">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-note" colSpan={6}>
                      Loading configs…
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td className="table-note" colSpan={6}>
                      Couldn&rsquo;t load the subscription — {loadError}.{" "}
                      <button className="rowlink" type="button" onClick={() => void load()}>
                        Try again
                      </button>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="table-note" colSpan={6}>
                      Nothing matches this filter.{" "}
                      <button
                        className="rowlink"
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setProto("all");
                        }}
                      >
                        Clear
                      </button>
                    </td>
                  </tr>
                ) : (
                  filtered.map((config, index) => {
                    const isActive = activeLink === config.link;
                    const isBusy = busy === config.link;
                    return (
                      <tr key={config.link} className={isActive ? "is-active" : undefined}>
                        <td className="num">{String(index + 1).padStart(2, "0")}</td>
                        <td>
                          <span className="proto">{config.proto}</span>
                        </td>
                        <td className="server">
                          {config.host}:{config.port}
                        </td>
                        <td className="remark" title={config.remark ?? ""}>
                          {config.remark || "—"}
                        </td>
                        <td className="lat">{latency(config)}</td>
                        <td className="act">
                          <button
                            className="rowlink"
                            type="button"
                            onClick={() => void copyLink(config)}
                          >
                            {copiedRow === config.link ? "Copied" : "Copy"}
                          </button>
                          <button
                            className="rowlink"
                            type="button"
                            onClick={() => void handleConnect(config)}
                            disabled={Boolean(busy) || isBusy}
                          >
                            {isActive ? "Disconnect" : isBusy ? "Connecting…" : "Connect"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="foot">
        <p>
          Updated {ago(snapshot?.updated)} · rebuilt every 6 hours in CI
        </p>
        <p className="foot-warning">
          Public third-party servers. Don&rsquo;t use them for sensitive traffic.
        </p>
      </footer>
    </div>
  );
}
