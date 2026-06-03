import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, ListChecks, MailWarning, RotateCcw, WifiOff } from "lucide-react";
import { QueueInspector } from "@/components/queue/QueueInspector";
import { OutboxList } from "@/components/outbox/OutboxList";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Button } from "@/components/ui/Button";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import { listAccountSyncHealth, syncHealthStatusLabel, type AccountSyncHealth } from "./syncHealthMock";
import { getQueueSummary, resetQueueSmokeFixtures } from "./pendingOperationsMock";

type SmokeTab = "queue" | "outbox" | "health";

const smokeAccounts = [
  {
    id: "acct-yandex",
    email: "yandex.demo@example.com",
    displayName: "Yandex Demo",
    avatarUrl: null,
    isActive: true,
    provider: "imap",
  },
  {
    id: "acct-gmail",
    email: "gmail.demo@example.com",
    displayName: "Gmail Demo",
    avatarUrl: null,
    isActive: false,
    provider: "gmail_api",
  },
  {
    id: "acct-localdb",
    email: "localdb.demo@example.com",
    displayName: "Local DB Demo",
    avatarUrl: null,
    isActive: false,
    provider: "imap",
  },
];

const forbiddenMarkers = [
  "rawBase64Url",
  "secret-token-must-not-render",
  "password-must-not-render",
  "oauth-secret-must-not-render",
  "Bearer secret-must-not-render",
  "Private body must stay hidden",
  "raw-mime-must-not-render",
];

export function QueueEpic03SmokeApp() {
  const [tab, setTab] = useState<SmokeTab>("queue");
  const [health, setHealth] = useState<AccountSyncHealth[]>([]);
  const [lastNavigation, setLastNavigation] = useState<string | null>(null);
  const isOnline = useUIStore((state) => state.isOnline);
  const pendingOpsCount = useUIStore((state) => state.pendingOpsCount);

  const seedStores = useCallback(async () => {
    useAccountStore.setState({
      accounts: smokeAccounts,
      activeAccountId: "acct-yandex",
    });
    const summary = await getQueueSummary();
    useUIStore.setState({
      isOnline: true,
      pendingOpsCount: summary.active,
      theme: "system",
      colorTheme: "neutral",
      fontScale: "default",
    });
    setHealth(await listAccountSyncHealth(smokeAccounts.map((account) => account.id)));
  }, []);

  useEffect(() => {
    void seedStores();
  }, [seedStores]);

  useEffect(() => {
    const refresh = async () => {
      const summary = await getQueueSummary();
      useUIStore.setState({ pendingOpsCount: summary.active });
      setHealth(await listAccountSyncHealth(smokeAccounts.map((account) => account.id)));
    };
    const navigationHandler = (event: Event) => {
      setLastNavigation(String((event as CustomEvent<string>).detail));
    };
    window.addEventListener("velo-queue-changed", refresh);
    window.addEventListener("velo-outbox-changed", refresh);
    window.addEventListener("velo-sync-health-changed", refresh);
    window.addEventListener("queue-smoke-navigation", navigationHandler);
    return () => {
      window.removeEventListener("velo-queue-changed", refresh);
      window.removeEventListener("velo-outbox-changed", refresh);
      window.removeEventListener("velo-sync-health-changed", refresh);
      window.removeEventListener("queue-smoke-navigation", navigationHandler);
    };
  }, []);

  const activeAccount = useAccountStore((state) => state.activeAccountId);
  const activeAccountLabel = useMemo(
    () => smokeAccounts.find((account) => account.id === activeAccount)?.email ?? "no account",
    [activeAccount],
  );

  const reset = useCallback(async () => {
    resetQueueSmokeFixtures();
    await seedStores();
  }, [seedStores]);

  const toggleOffline = useCallback(async () => {
    const nextOnline = !useUIStore.getState().isOnline;
    const summary = await getQueueSummary();
    useUIStore.setState({
      isOnline: nextOnline,
      pendingOpsCount: summary.active,
    });
    setHealth(await listAccountSyncHealth(smokeAccounts.map((account) => account.id)));
  }, []);

  const dispatchQueueChanged = useCallback(() => {
    window.dispatchEvent(new Event("velo-queue-changed"));
  }, []);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <OfflineBanner />
      <header className="border-b border-border-primary bg-bg-secondary/80 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <ListChecks size={20} className="text-accent" />
            <div>
              <h1 className="text-base font-semibold">EPIC-03 Queue UI Smoke</h1>
              <p className="text-xs text-text-tertiary">
                Temporary web harness: fake queue, fake health, no Tauri SQLite.
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void reset()}>
              Reset fixtures
            </Button>
            <Button variant={isOnline ? "secondary" : "danger"} icon={<WifiOff size={14} />} onClick={() => void toggleOffline()}>
              {isOnline ? "Toggle offline" : "Back online"}
            </Button>
            <Button variant="secondary" icon={<Database size={14} />} onClick={dispatchQueueChanged}>
              Dispatch queue changed
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-text-secondary md:grid-cols-3">
          <div className="rounded-md border border-border-primary bg-bg-primary/70 px-3 py-2">
            Active account: <b className="text-text-primary">{activeAccountLabel}</b>
          </div>
          <div className="rounded-md border border-border-primary bg-bg-primary/70 px-3 py-2">
            Queue active count: <b className="text-text-primary">{pendingOpsCount}</b>
          </div>
          <div className="rounded-md border border-border-primary bg-bg-primary/70 px-3 py-2">
            Last mock navigation: <b className="text-text-primary">{lastNavigation ?? "none"}</b>
          </div>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-120px)] grid-cols-[260px_1fr]">
        <aside className="border-r border-border-primary bg-bg-secondary/50 p-4">
          <div className="space-y-2">
            {[
              ["queue", "Queue Inspector"],
              ["outbox", "Outbox"],
              ["health", "Sync Health"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as SmokeTab)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  tab === id ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-border-primary bg-bg-primary/70 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-primary">
              <AlertTriangle size={14} className="text-warning" />
              Forbidden markers
            </div>
            <p className="text-xs text-text-tertiary">
              These strings exist in fixtures and must not appear inside Queue Inspector rows.
            </p>
            <div className="mt-2 space-y-1">
              {forbiddenMarkers.map((marker) => (
                <code key={marker} className="block truncate rounded bg-bg-tertiary px-2 py-1 text-[0.65rem] text-text-tertiary">
                  {marker}
                </code>
              ))}
            </div>
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden">
          {tab === "queue" && <QueueInspector />}
          {tab === "outbox" && (
            <div className="mx-auto max-w-[900px] p-6">
              <div className="mb-3 flex items-center gap-2">
                <MailWarning size={18} className="text-accent" />
                <h2 className="text-base font-semibold">Outbox retry/cancel smoke</h2>
              </div>
              <div className="overflow-hidden rounded-lg border border-border-primary bg-bg-secondary/70">
                <OutboxList />
              </div>
            </div>
          )}
          {tab === "health" && (
            <div className="mx-auto max-w-[900px] p-6">
              <div className="mb-4 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-accent" />
                <h2 className="text-base font-semibold">Account Sync Health</h2>
              </div>
              <div className="space-y-2">
                {health.map((item) => (
                  <article key={item.accountId} className="rounded-lg border border-border-primary bg-bg-secondary/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">{item.accountId}</h3>
                      <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-xs text-text-secondary">
                        {syncHealthStatusLabel(item.status)}
                      </span>
                      {item.diagnosticCode && (
                        <code className="rounded bg-bg-tertiary px-2 py-0.5 text-xs text-text-tertiary">
                          {item.diagnosticCode}
                        </code>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-secondary md:grid-cols-4">
                      <span>Pending: <b>{item.queue.pending}</b></span>
                      <span>Retry: <b>{item.queue.retryScheduled}</b></span>
                      <span>Failed: <b>{item.queue.failed}</b></span>
                      <span>Blocked: <b>{item.queue.blocked}</b></span>
                    </div>
                    {item.blockedReason && (
                      <p className="mt-2 rounded-md bg-bg-primary/70 px-2 py-1.5 text-xs text-danger">
                        {item.blockedReason}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
