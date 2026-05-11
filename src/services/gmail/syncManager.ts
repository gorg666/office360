import { getGmailClient } from "./tokenManager";
import { initialSync, deltaSync, type SyncProgress } from "./sync";
import { getAccount, clearAccountHistoryId } from "../db/accounts";
import { getSetting } from "../db/settings";
import { getThreadCountForAccount, deleteAllThreadsForAccount } from "../db/threads";
import { deleteAllMessagesForAccount } from "../db/messages";
import { imapInitialSync, imapDeltaSync } from "../imap/imapSync";
import { clearAllFolderSyncStates } from "../db/folderSyncState";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { hasCalendarSupport, getCalendarProvider } from "../calendar/providerFactory";
import { getVisibleCalendars, upsertCalendar, updateCalendarSyncToken } from "../db/calendars";
import { upsertCalendarEvent, deleteEventByRemoteId } from "../db/calendarEvents";

/** When the window/tab is visible — pick up new mail quickly while the app is open. */
const SYNC_INTERVAL_VISIBLE_MS = 10_000;
/** When hidden/minimized — back off to limit CPU and network. */
const SYNC_INTERVAL_HIDDEN_MS = 120_000;

interface ReconnectDiagnosticContext {
  accountId?: string;
  provider?: string | null;
  reason?: string;
  extra?: Record<string, unknown>;
}

function logReconnectDiagnostic(origin: string, context: ReconnectDiagnosticContext = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    origin,
    accountId: context.accountId ?? null,
    provider: context.provider ?? null,
    reason: context.reason ?? null,
    ...context.extra,
  };
  console.warn("[reconnect-diagnostic]", payload);
  console.trace(`[reconnect-diagnostic] trace from ${origin}`);
}

/** Map IMAP sync phases to the SyncProgress phases the UI understands. */
function mapImapPhase(phase: string): "labels" | "threads" | "messages" | "done" {
  if (phase === "folders") return "labels";
  if (phase === "threading" || phase === "storing_threads") return "threads";
  if (phase === "messages") return "messages";
  if (phase === "done") return "done";
  return phase as "labels" | "threads" | "messages" | "done";
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundAccountIds: string[] | null = null;
let visibilityListenerAttached = false;
let syncPromise: Promise<void> | null = null;
let pendingAccountIds: string[] | null = null;
let dbReady = false;
let resolveDbReady: (() => void) | null = null;
const dbReadyPromise = new Promise<void>((resolve) => {
  resolveDbReady = resolve;
});

const DB_LOCK_RETRY_ATTEMPTS = 4;
const DB_LOCK_RETRY_BASE_MS = 350;

function getAdaptiveSyncDelayMs(): number {
  if (typeof document === "undefined") return SYNC_INTERVAL_VISIBLE_MS;
  return document.hidden ? SYNC_INTERVAL_HIDDEN_MS : SYNC_INTERVAL_VISIBLE_MS;
}

function scheduleNextPeriodicSync(): void {
  if (!backgroundAccountIds) return;
  if (syncTimer) clearTimeout(syncTimer);
  const delay = getAdaptiveSyncDelayMs();
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const ids = backgroundAccountIds;
    if (!ids || ids.length === 0) return;
    logReconnectDiagnostic("startBackgroundSync.intervalTick", {
      reason: "periodic_sync_tick",
      extra: { intervalMs: delay, accountIds: ids },
    });
    void runPeriodicSync(ids);
  }, delay);
}

function attachVisibilitySyncListener(): void {
  if (visibilityListenerAttached || typeof document === "undefined") return;
  visibilityListenerAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (!backgroundAccountIds?.length) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    scheduleNextPeriodicSync();
  });
}

async function waitForSyncIdle(): Promise<void> {
  while (syncPromise) {
    await syncPromise;
  }
}

function isDatabaseLockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /database is locked|database busy|SQLITE_BUSY|code["']?\s*[:=]\s*5|\(code:\s*5\)/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabaseReady(): Promise<void> {
  if (dbReady) return;
  await dbReadyPromise;
}

export type SyncStatusCallback = (
  accountId: string,
  status: "syncing" | "done" | "error",
  progress?: SyncProgress,
  error?: string,
) => void;

let statusCallback: SyncStatusCallback | null = null;

export function onSyncStatus(cb: SyncStatusCallback): () => void {
  statusCallback = cb;
  return () => {
    statusCallback = null;
  };
}

/**
 * Run a sync for a single Gmail API account (initial or delta).
 */
async function syncGmailAccount(accountId: string): Promise<void> {
  const client = await getGmailClient(accountId);
  const account = await getAccount(accountId);

  if (!account) {
    throw new Error("Account not found");
  }

  const syncPeriodStr = await getSetting("sync_period_days");
  const syncDays = parseInt(syncPeriodStr ?? "365", 10) || 365;

  if (account.history_id) {
    // Delta sync
    try {
      await deltaSync(client, accountId, account.history_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "");
      if (message === "HISTORY_EXPIRED") {
        // Fallback to full sync
        await initialSync(client, accountId, syncDays, (progress) => {
          statusCallback?.(accountId, "syncing", progress);
        });
      } else {
        throw err;
      }
    }
  } else {
    // First time — full initial sync
    await initialSync(client, accountId, syncDays, (progress) => {
      statusCallback?.(accountId, "syncing", progress);
    });
  }
}

/**
 * Run a sync for a single IMAP account (initial or delta).
 */
async function syncImapAccount(accountId: string): Promise<void> {
  const account = await getAccount(accountId);

  if (!account) {
    throw new Error("Account not found");
  }

  // Refresh OAuth2 token before syncing (if applicable)
  if (account.auth_method === "oauth2") {
    try {
      await ensureFreshToken(account);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "Unknown token refresh error");
      logReconnectDiagnostic("syncImapAccount.ensureFreshToken", {
        accountId,
        provider: account.oauth_provider,
        reason: message,
      });
      throw err;
    }
  }

  const syncPeriodStr = await getSetting("sync_period_days");
  const syncDays = parseInt(syncPeriodStr ?? "365", 10) || 365;

  if (account.history_id) {
    // Delta sync — IMAP uses folder-level UID tracking
    const result = await imapDeltaSync(accountId, syncDays);

    // Recovery: if delta sync found nothing new but the DB has no threads,
    // the previous initial sync likely failed or stored data incorrectly.
    // Force a full re-sync to recover.
    if (result.messages.length === 0) {
      const threadCount = await getThreadCountForAccount(accountId);
      if (threadCount === 0) {
        console.warn(`[syncManager] IMAP delta sync returned 0 new messages and DB has 0 threads for ${accountId} — forcing full re-sync`);
        await clearAccountHistoryId(accountId);
        await clearAllFolderSyncStates(accountId);
        await imapInitialSync(accountId, syncDays, (progress) => {
          statusCallback?.(accountId, "syncing", {
            phase: mapImapPhase(progress.phase),
            current: progress.current,
            total: progress.total,
          });
        });
      }
    }
  } else {
    // First time — full initial sync
    await imapInitialSync(accountId, syncDays, (progress) => {
      statusCallback?.(accountId, "syncing", {
        phase: mapImapPhase(progress.phase),
        current: progress.current,
        total: progress.total,
      });
    });
  }
}

/**
 * Sync calendars for a single account via the CalendarProvider abstraction.
 * Discovers calendars, syncs events for each visible calendar, stores results in DB.
 */
async function syncCalendarForAccount(accountId: string): Promise<void> {
  try {
    const supported = await hasCalendarSupport(accountId);
    if (!supported) return;

    const provider = await getCalendarProvider(accountId);

    // Discover/update calendars
    const calendarInfos = await provider.listCalendars();
    for (const cal of calendarInfos) {
      await upsertCalendar({
        accountId,
        provider: provider.type,
        remoteId: cal.remoteId,
        displayName: cal.displayName,
        color: cal.color,
        isPrimary: cal.isPrimary,
      });
    }

    // Sync events for each visible calendar
    const visibleCals = await getVisibleCalendars(accountId);
    for (const cal of visibleCals) {
      try {
        const syncResult = await provider.syncEvents(cal.remote_id, cal.sync_token ?? undefined);

        // Upsert created/updated events
        for (const event of [...syncResult.created, ...syncResult.updated]) {
          await upsertCalendarEvent({
            accountId,
            googleEventId: event.remoteEventId,
            summary: event.summary,
            description: event.description,
            location: event.location,
            startTime: event.startTime,
            endTime: event.endTime,
            isAllDay: event.isAllDay,
            status: event.status,
            organizerEmail: event.organizerEmail,
            attendeesJson: event.attendeesJson,
            htmlLink: event.htmlLink,
            calendarId: cal.id,
            remoteEventId: event.remoteEventId,
            etag: event.etag,
            icalData: event.icalData,
            uid: event.uid,
          });
        }

        // Delete removed events
        for (const remoteId of syncResult.deletedRemoteIds) {
          await deleteEventByRemoteId(cal.id, remoteId);
        }

        // Update sync token
        if (syncResult.newSyncToken || syncResult.newCtag) {
          await updateCalendarSyncToken(cal.id, syncResult.newSyncToken, syncResult.newCtag);
        }
      } catch (err) {
        console.warn(`[syncManager] Calendar sync failed for ${cal.display_name ?? cal.remote_id}:`, err);
      }
    }

    // Emit event for UI update
    window.dispatchEvent(new CustomEvent("velo-calendar-sync-done"));
  } catch (err) {
    console.warn(`[syncManager] Calendar sync failed for account ${accountId}:`, err);
  }
}

/**
 * Run a sync for a single account (initial or delta).
 * Routes to Gmail or IMAP sync based on account provider.
 */
async function syncAccountInternal(accountId: string): Promise<void> {
  for (let attempt = 1; attempt <= DB_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const account = await getAccount(accountId);

      if (!account) {
        throw new Error("Account not found");
      }

      statusCallback?.(accountId, "syncing");

      console.log(`[syncManager] Syncing account ${accountId} (provider=${account.provider}, history_id=${account.history_id ?? "null"})`);

      if (account.provider === "caldav") {
        // CalDAV-only accounts — skip email sync, only sync calendar
        await syncCalendarForAccount(accountId);
        statusCallback?.(accountId, "done");
        return;
      }

      if (account.provider === "imap") {
        await syncImapAccount(accountId);
      } else {
        await syncGmailAccount(accountId);
      }

      // Always emit "done" when an initial sync completes (clears the bar).
      // Also emit for delta syncs that fell back to initial (recovery re-sync)
      // since those emit progress via statusCallback inside syncImapAccount.
      statusCallback?.(accountId, "done");

      // Sync calendar alongside email (non-blocking — calendar errors don't affect email sync)
      syncCalendarForAccount(accountId).catch((err) => {
        console.warn(`[syncManager] Calendar sync error for ${accountId}:`, err);
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
      const isDbLock = isDatabaseLockedError(err);
      if (isDbLock && attempt < DB_LOCK_RETRY_ATTEMPTS) {
        const delayMs = Math.min(DB_LOCK_RETRY_BASE_MS * (2 ** (attempt - 1)), 3_000);
        console.warn(
          `[syncManager] Database is locked during sync for ${accountId}; retry ${attempt}/${DB_LOCK_RETRY_ATTEMPTS - 1} in ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      console.error(`[syncManager] Sync failed for account ${accountId}:`, message);
      statusCallback?.(accountId, "error", undefined, message);
      return;
    }
  }
}

async function runSync(accountIds: string[]): Promise<void> {
  await waitForDatabaseReady();

  if (syncPromise) {
    // Queue these accounts, merging with any already-pending IDs
    const existing = new Set(pendingAccountIds ?? []);
    for (const id of accountIds) existing.add(id);
    pendingAccountIds = [...existing];
    logReconnectDiagnostic("runSync.queueWhileBusy", {
      reason: "syncPromise_in_progress",
      extra: { queuedAccountIds: [...existing] },
    });
    return syncPromise;
  }

  syncPromise = (async () => {
    let queue = [...accountIds];
    try {
      while (queue.length > 0) {
        const id = queue.shift()!;
        await syncAccountInternal(id);

        if (pendingAccountIds) {
          const queued = pendingAccountIds;
          pendingAccountIds = null;
          const merged = new Set([...queued, ...queue]);
          queue = [...merged];
        }
      }
    } finally {
      syncPromise = null;
    }

    // Drain the queue — if something was queued while we were syncing, run it now
    if (pendingAccountIds) {
      const queued = pendingAccountIds;
      pendingAccountIds = null;
      await runSync(queued);
    }
  })();

  return syncPromise;
}

async function runPeriodicSync(accountIds: string[]): Promise<void> {
  const [primaryAccountId, ...secondaryAccountIds] = accountIds;
  if (!primaryAccountId) return;

  try {
    await runSync([primaryAccountId]);
  } finally {
    scheduleNextPeriodicSync();
  }

  if (secondaryAccountIds.length > 0) {
    void runSync(secondaryAccountIds).catch((err) => {
      console.error("[syncManager] Background secondary sync failed:", err);
    });
  }
}

/**
 * Run sync for a single account, queuing if already running.
 */
export async function syncAccount(accountId: string): Promise<void> {
  return runSync([accountId]);
}

/**
 * Start the background sync timer for all accounts.
 * When `skipImmediateSync` is true the first periodic sync is deferred to the
 * next interval tick — useful when the caller already triggered a sync for a
 * newly-added account and doesn't want existing accounts to block it.
 */
export function startBackgroundSync(accountIds: string[], skipImmediateSync = false): void {
  stopBackgroundSync();

  backgroundAccountIds = [...accountIds];
  attachVisibilitySyncListener();

  if (!skipImmediateSync) {
    logReconnectDiagnostic("startBackgroundSync.immediateSync", {
      reason: "startBackgroundSync",
      extra: { accountIds },
    });
    void runPeriodicSync(accountIds);
  } else {
    scheduleNextPeriodicSync();
  }
}

export function markSyncDatabaseReady(): void {
  if (dbReady) return;
  dbReady = true;
  resolveDbReady?.();
}

/**
 * Stop the background sync timer.
 */
export function stopBackgroundSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  backgroundAccountIds = null;
}

/**
 * Trigger an immediate sync for all provided accounts.
 * Waits for completion even if a background sync is in progress.
 */
export async function triggerSync(accountIds: string[]): Promise<void> {
  await runSync(accountIds);
}

/**
 * Clear history IDs and perform a full re-sync for all provided accounts.
 * This re-downloads all threads from scratch.
 */
export async function forceFullSync(accountIds: string[]): Promise<void> {
  await waitForSyncIdle();
  for (const id of accountIds) {
    await clearAccountHistoryId(id);
  }
  await runSync(accountIds);
}

/**
 * Delete all local data for a single account and re-sync from scratch.
 * Removes all threads, messages, history ID, and IMAP folder sync states,
 * then runs a fresh initial sync.
 */
export async function resyncAccount(accountId: string): Promise<void> {
  await waitForSyncIdle();
  await deleteAllThreadsForAccount(accountId);
  await deleteAllMessagesForAccount(accountId);
  await clearAccountHistoryId(accountId);
  await clearAllFolderSyncStates(accountId);
  await runSync([accountId]);
}
