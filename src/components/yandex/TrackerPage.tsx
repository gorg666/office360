import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Plus, RefreshCw, Search } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useAccountStore } from "@/stores/accountStore";
import {
  authorizeYandexServices,
  resolveYandexAccount,
  resolveYandexOrgForTracker,
  setStoredYandexOrgId,
  type YandexOrganization,
} from "@/services/yandex/accountApi";
import {
  addTrackerComment,
  createTrackerIssue,
  executeTrackerTransition,
  getTrackerAccessMode,
  getTrackerCooldownRemainingMs,
  getTrackerIssue,
  invalidateTrackerSessionCache,
  isTrackerReadOnlyError,
  listTrackerAttachments,
  listTrackerComments,
  listTrackerTransitions,
  loadTrackerSessionMetadata,
  resetTrackerAccessMode,
  searchTrackerIssues,
  TRACKER_READ_ONLY_DOCS_URL,
  TRACKER_READ_ONLY_MESSAGE,
  TRACKER_WRITE_DISABLED_HINT,
  updateTrackerIssue,
  uploadTrackerAttachment,
  type TrackerAccessMode,
  type TrackerAttachment,
  type TrackerComment,
  type TrackerIssue,
  type TrackerQueue,
  type TrackerRef,
  type TrackerTransition,
} from "@/services/yandex/tracker";
import { ServicePageShell } from "./ServicePageShell";

const TRACKER_CONSENT_MESSAGE =
  "Для работы с Яндекс Трекером разрешите Office360 доступ. Откроется официальное окно авторизации Яндекса.";

const ORG_HELP =
  "Можно найти в настройках организации Яндекс 360 / Tracker.";

const ASSIGNEE_DEBOUNCE_MS = 300;

export function buildTrackerIssueFilter(input: {
  queue: string;
  status: string;
  priority: string;
  assignee: string;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = input.queue ? { queue: input.queue } : { assignee: "me()" };
  if (input.status) filter.status = input.status;
  if (input.priority) filter.priority = input.priority;
  if (input.assignee.trim()) filter.assignee = input.assignee.trim();
  return filter;
}

export function TrackerPage() {
  const accountId = useAccountStore((state) => state.activeAccountId);
  const [orgId, setOrgId] = useState("");
  const [orgCandidates, setOrgCandidates] = useState<YandexOrganization[] | null>(null);
  const [manualOrgInput, setManualOrgInput] = useState("");
  const [orgHint, setOrgHint] = useState<string | null>(null);
  const [needsReconsent, setNeedsReconsent] = useState(false);
  const [queues, setQueues] = useState<TrackerQueue[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [selected, setSelected] = useState<TrackerIssue | null>(null);
  const [comments, setComments] = useState<TrackerComment[]>([]);
  const [transitions, setTransitions] = useState<TrackerTransition[]>([]);
  const [queue, setQueue] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<TrackerRef[]>([]);
  const [priorities, setPriorities] = useState<TrackerRef[]>([]);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [attachments, setAttachments] = useState<TrackerAttachment[]>([]);
  const [reauthorizing, setReauthorizing] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [metaReady, setMetaReady] = useState(false);
  const [accessMode, setAccessMode] = useState<TrackerAccessMode>(() => getTrackerAccessMode());

  const initGenRef = useRef(0);
  const skipNextFilterSearchRef = useRef(false);
  const filtersRef = useRef({ queue, status, priority, assignee });
  filtersRef.current = { queue, status, priority, assignee };
  const loadTrackerDataRef = useRef<(activeAccountId: string, options?: { forceRefresh?: boolean }) => Promise<void>>(
    async () => undefined,
  );
  const searchIssuesOnlyRef = useRef<(activeAccountId: string) => Promise<void>>(async () => undefined);

  const syncCooldown = useCallback(() => {
    setCooldownSec(Math.ceil(getTrackerCooldownRemainingMs() / 1000));
  }, []);

  const syncAccessMode = useCallback(() => {
    setAccessMode(getTrackerAccessMode());
  }, []);

  const noteTrackerError = useCallback(
    (err: unknown) => {
      syncCooldown();
      syncAccessMode();
      if (isTrackerReadOnlyError(err) || getTrackerAccessMode() === "READ_ONLY") {
        setAccessMode("READ_ONLY");
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    },
    [syncAccessMode, syncCooldown],
  );

  useEffect(() => {
    syncCooldown();
    if (cooldownSec <= 0 && getTrackerCooldownRemainingMs() <= 0) return;
    const id = window.setInterval(syncCooldown, 1000);
    return () => window.clearInterval(id);
  }, [cooldownSec, syncCooldown, error]);

  const searchIssuesOnly = useCallback(async (activeAccountId: string) => {
    if (getTrackerCooldownRemainingMs() > 0) {
      syncCooldown();
      setError(
        `Слишком много запросов к Яндекс Трекеру. Повторим через ${Math.max(1, Math.ceil(getTrackerCooldownRemainingMs() / 1000))} сек.`,
      );
      return;
    }
    const filter = buildTrackerIssueFilter(filtersRef.current);
    setIssues(await searchTrackerIssues(activeAccountId, filter));
  }, [syncCooldown]);
  searchIssuesOnlyRef.current = searchIssuesOnly;

  const loadTrackerData = useCallback(async (activeAccountId: string, options?: { forceRefresh?: boolean }) => {
    if (getTrackerCooldownRemainingMs() > 0) {
      syncCooldown();
      throw new Error(
        `Слишком много запросов к Яндекс Трекеру. Повторим через ${Math.max(1, Math.ceil(getTrackerCooldownRemainingMs() / 1000))} сек.`,
      );
    }
    if (options?.forceRefresh) {
      invalidateTrackerSessionCache(activeAccountId);
    }
    const meta = await loadTrackerSessionMetadata(activeAccountId, { force: options?.forceRefresh });
    setQueues(meta.queues);
    setStatuses(meta.statuses);
    setPriorities(meta.priorities);
    setMetaReady(true);
    await searchIssuesOnlyRef.current(activeAccountId);
  }, [syncCooldown]);
  loadTrackerDataRef.current = loadTrackerData;

  // Full initialize only on mount / accountId change (StrictMode-safe via session in-flight dedupe).
  useEffect(() => {
    if (!accountId) return;
    const gen = ++initGenRef.current;
    let cancelled = false;
    resetTrackerAccessMode();
    setAccessMode("UNKNOWN");
    skipNextFilterSearchRef.current = true;
    setMetaReady(false);
    setOrgId("");
    setOrgCandidates(null);
    setOrgHint(null);
    setNeedsReconsent(false);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const resolved = await resolveYandexOrgForTracker(accountId);
        if (cancelled || gen !== initGenRef.current) return;
        if (resolved.status === "ready") {
          setOrgId(resolved.orgId);
          skipNextFilterSearchRef.current = true;
          await loadTrackerDataRef.current(accountId);
          return;
        }
        if (resolved.status === "pick") {
          setOrgId("");
          setOrgCandidates(resolved.organizations);
          return;
        }
        setOrgId("");
        setOrgHint(resolved.message);
        setNeedsReconsent(resolved.needsReconsent);
      } catch (err) {
        if (cancelled || gen !== initGenRef.current) return;
        noteTrackerError(err);
      } finally {
        if (!cancelled && gen === initGenRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, noteTrackerError]);

  // Filters → issues search only (debounced for assignee text).
  useEffect(() => {
    if (!accountId || !orgId || !metaReady) return;
    if (skipNextFilterSearchRef.current) {
      skipNextFilterSearchRef.current = false;
      return;
    }
    if (getTrackerCooldownRemainingMs() > 0) {
      syncCooldown();
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setLoading(true);
          setError(null);
          await searchIssuesOnlyRef.current(accountId);
        } catch (err) {
          noteTrackerError(err);
        } finally {
          setLoading(false);
        }
      })();
    }, ASSIGNEE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [accountId, orgId, metaReady, queue, status, priority, assignee, noteTrackerError, syncCooldown]);

  const manualRefresh = async () => {
    if (!accountId || !orgId) return;
    if (getTrackerCooldownRemainingMs() > 0) {
      syncCooldown();
      setError(
        `Слишком много запросов к Яндекс Трекеру. Повторим через ${Math.max(1, Math.ceil(getTrackerCooldownRemainingMs() / 1000))} сек.`,
      );
      return;
    }
    setLoading(true);
    setError(null);
    resetTrackerAccessMode();
    setAccessMode("UNKNOWN");
    try {
      skipNextFilterSearchRef.current = true;
      await loadTrackerData(accountId, { forceRefresh: true });
      syncAccessMode();
    } catch (err) {
      noteTrackerError(err);
    } finally {
      setLoading(false);
    }
  };

  const reconnect = async () => {
    if (!accountId) return;
    if (!window.confirm(TRACKER_CONSENT_MESSAGE)) return;
    setReauthorizing(true);
    setError(null);
    resetTrackerAccessMode();
    setAccessMode("UNKNOWN");
    try {
      await authorizeYandexServices(accountId);
      invalidateTrackerSessionCache(accountId);
      skipNextFilterSearchRef.current = true;
      setMetaReady(false);
      setLoading(true);
      const resolved = await resolveYandexOrgForTracker(accountId);
      if (resolved.status === "ready") {
        setOrgId(resolved.orgId);
        await loadTrackerData(accountId, { forceRefresh: true });
        syncAccessMode();
      } else if (resolved.status === "pick") {
        setOrgId("");
        setOrgCandidates(resolved.organizations);
      } else {
        setOrgId("");
        setOrgHint(resolved.message);
        setNeedsReconsent(resolved.needsReconsent);
      }
    } catch (err) {
      noteTrackerError(err);
    } finally {
      setLoading(false);
      setReauthorizing(false);
    }
  };

  const saveOrgChoice = async (nextOrgId: string) => {
    if (!accountId || !nextOrgId.trim()) return;
    if (getTrackerCooldownRemainingMs() > 0) {
      syncCooldown();
      setError(
        `Слишком много запросов к Яндекс Трекеру. Повторим через ${Math.max(1, Math.ceil(getTrackerCooldownRemainingMs() / 1000))} сек.`,
      );
      return;
    }
    setLoading(true);
    setError(null);
    resetTrackerAccessMode();
    setAccessMode("UNKNOWN");
    try {
      const account = await resolveYandexAccount(accountId);
      await setStoredYandexOrgId(account.id, nextOrgId.trim());
      setOrgId(nextOrgId.trim());
      setOrgCandidates(null);
      setOrgHint(null);
      setManualOrgInput("");
      invalidateTrackerSessionCache(accountId);
      skipNextFilterSearchRef.current = true;
      await loadTrackerData(accountId, { forceRefresh: true });
      syncAccessMode();
    } catch (err) {
      noteTrackerError(err);
    } finally {
      setLoading(false);
    }
  };

  const openIssue = async (issue: TrackerIssue) => {
    try {
      const full = await getTrackerIssue(accountId, issue.key);
      setSelected(full);
      const [nextComments, nextTransitions, nextAttachments] = await Promise.all([
        listTrackerComments(accountId, issue.key),
        listTrackerTransitions(accountId, issue.key),
        listTrackerAttachments(accountId, issue.key),
      ]);
      setComments(nextComments);
      setTransitions(nextTransitions);
      setAttachments(nextAttachments);
    } catch (err) {
      noteTrackerError(err);
    }
  };

  const createIssue = async () => {
    if (accessMode === "READ_ONLY") return;
    const summary = window.prompt("Название задачи");
    if (!summary?.trim()) return;
    const queueKey = queue || queues[0]?.key;
    if (!queueKey) {
      setError("Выберите доступную очередь.");
      return;
    }
    try {
      await createTrackerIssue(accountId, { summary: summary.trim(), queue: queueKey });
      await searchIssuesOnly(accountId!);
    } catch (err) {
      noteTrackerError(err);
    }
  };

  const addComment = async () => {
    if (!selected || accessMode === "READ_ONLY") return;
    const text = window.prompt("Комментарий");
    if (!text?.trim()) return;
    try {
      await addTrackerComment(accountId, selected.key, text.trim());
      setComments(await listTrackerComments(accountId, selected.key));
    } catch (err) {
      noteTrackerError(err);
    }
  };

  const changeTransition = async (id: string) => {
    if (!selected || !accountId || accessMode === "READ_ONLY") return;
    try {
      await executeTrackerTransition(accountId, selected.key, id);
      await openIssue(selected);
      await searchIssuesOnly(accountId);
    } catch (err) {
      noteTrackerError(err);
    }
  };

  const changePriority = async () => {
    if (!selected || !accountId || accessMode === "READ_ONLY") return;
    const next = window.prompt("Ключ приоритета", selected.priority?.key ?? "normal");
    if (!next) return;
    try {
      const updated = await updateTrackerIssue(accountId, selected.key, { priority: next });
      setSelected(updated);
      await searchIssuesOnly(accountId);
    } catch (err) {
      noteTrackerError(err);
    }
  };

  const editIssue = async () => {
    if (!selected || !accountId || accessMode === "READ_ONLY") return;
    const summary = window.prompt("Название", selected.summary);
    if (!summary) return;
    const description = window.prompt("Описание", selected.description ?? "");
    const deadline = window.prompt("Срок YYYY-MM-DD", selected.deadline ?? "");
    try {
      const updated = await updateTrackerIssue(accountId, selected.key, {
        summary,
        description: description ?? selected.description,
        deadline: deadline || null,
      });
      setSelected(updated);
      await searchIssuesOnly(accountId);
    } catch (err) {
      noteTrackerError(err);
    }
  };

  const attachFile = async () => {
    if (!selected || accessMode === "READ_ONLY") return;
    try {
      const path = await open({ multiple: false, directory: false });
      if (!path) return;
      const data = await readFile(path);
      const name = path.replace(/\\/g, "/").split("/").pop()!;
      await uploadTrackerAttachment(accountId, selected.key, name, data);
      setAttachments(await listTrackerAttachments(accountId, selected.key));
    } catch (err) {
      noteTrackerError(err);
    }
  };

  const shownIssues = issues.filter(
    (issue) => !query || `${issue.key} ${issue.summary}`.toLowerCase().includes(query.toLowerCase()),
  );

  const showOrgSetup = !orgId;
  const liveCooldownSec = Math.max(cooldownSec, Math.ceil(getTrackerCooldownRemainingMs() / 1000));
  const refreshDisabled = loading || liveCooldownSec > 0;
  const readOnly = accessMode === "READ_ONLY";
  const writesDisabled = readOnly || liveCooldownSec > 0;
  const writeDisabledTitle = readOnly
    ? TRACKER_WRITE_DISABLED_HINT
    : liveCooldownSec > 0
      ? `Слишком много запросов. Повторим через ${liveCooldownSec} сек.`
      : undefined;
  const showAuthCta =
    needsReconsent ||
    Boolean(error && /Необходимо обновить доступ к Яндекс Трекеру/i.test(error));
  const showErrorBanner = Boolean(error || (needsReconsent && orgHint));

  return (
    <ServicePageShell
      title="Яндекс Трекер"
      description="Задачи организации"
      actions={
        <button
          className="btn-primary px-3 py-2 flex gap-2"
          onClick={createIssue}
          disabled={!orgId || writesDisabled}
          title={writeDisabledTitle}
        >
          <Plus size={16} />
          Создать задачу
        </button>
      }
    >
      {readOnly && (
        <div
          className="mb-4 rounded-md border border-border-primary bg-bg-secondary p-3 text-sm flex items-start justify-between gap-3"
          role="status"
          data-testid="tracker-read-only-banner"
        >
          <span>{TRACKER_READ_ONLY_MESSAGE}</span>
          <a
            className="shrink-0 text-accent underline"
            href={TRACKER_READ_ONLY_DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Подробнее
          </a>
        </div>
      )}

      {showErrorBanner && (
        <div className="mb-4 rounded-md bg-danger/10 text-danger p-3 text-sm flex items-center justify-between gap-3">
          <span>{error || orgHint}</span>
          {showAuthCta && (
            <button className="btn-secondary shrink-0 px-3 py-1.5" disabled={reauthorizing} onClick={reconnect}>
              {reauthorizing ? "Авторизация…" : "Обновить доступ"}
            </button>
          )}
        </div>
      )}

      {showOrgSetup && orgCandidates && orgCandidates.length > 1 && (
        <div className="max-w-lg border border-border-primary rounded-lg p-5 mb-4">
          <h2 className="font-medium mb-2">Организация Яндекс 360</h2>
          <p className="text-sm text-text-tertiary mb-3">Выберите организацию для Трекера.</p>
          <ul className="space-y-2">
            {orgCandidates.map((org) => {
              const id = String(org.id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="w-full text-left border border-border-primary rounded-md px-3 py-2 hover:bg-bg-hover"
                    onClick={() => void saveOrgChoice(id)}
                  >
                    <div className="font-medium">{org.name || `Организация ${id}`}</div>
                    <div className="text-xs text-text-tertiary mt-0.5">{id}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showOrgSetup && !orgCandidates && (
        <div className="max-w-lg border border-border-primary rounded-lg p-5">
          <h2 className="font-medium mb-2">Организация Яндекс 360</h2>
          <p className="text-sm text-text-tertiary mb-1">
            {orgHint || "Автоматически определить организацию не удалось."}
          </p>
          <p className="text-sm text-text-tertiary mb-3">{ORG_HELP}</p>
          <label className="block text-sm mb-1" htmlFor="tracker-org-id">
            Идентификатор организации
          </label>
          <div className="flex gap-2">
            <input
              id="tracker-org-id"
              className="flex-1 bg-bg-secondary border border-border-primary rounded-md px-3 py-2"
              value={manualOrgInput}
              onChange={(e) => setManualOrgInput(e.target.value)}
              placeholder="Например, 1234567"
              autoComplete="off"
            />
            <button
              className="btn-primary px-4"
              disabled={!manualOrgInput.trim() || loading || liveCooldownSec > 0}
              onClick={() => void saveOrgChoice(manualOrgInput)}
            >
              Сохранить
            </button>
          </div>
          {needsReconsent && (
            <button className="btn-secondary mt-3 px-3 py-1.5" disabled={reauthorizing} onClick={reconnect}>
              {reauthorizing ? "Авторизация…" : "Обновить доступ"}
            </button>
          )}
        </div>
      )}

      {orgId && (
        <div className="h-full min-h-[500px] grid grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.4fr)] gap-4">
          <section className="border border-border-primary rounded-lg overflow-hidden flex flex-col">
            <div className="p-3 border-b border-border-primary grid grid-cols-2 gap-2">
              <select
                className="bg-bg-secondary border border-border-primary rounded px-2"
                value={queue}
                onChange={(e) => setQueue(e.target.value)}
                disabled={liveCooldownSec > 0}
              >
                <option value="">Мои задачи</option>
                {queues.map((item) => (
                  <option key={item.id ?? item.key} value={item.key}>
                    {item.name ?? item.display ?? item.key}
                  </option>
                ))}
              </select>
              <select
                className="bg-bg-secondary border border-border-primary rounded px-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={liveCooldownSec > 0}
              >
                <option value="">Все статусы</option>
                {statuses.map((item) => (
                  <option key={item.id ?? item.key} value={item.key ?? item.id}>
                    {item.display}
                  </option>
                ))}
              </select>
              <select
                className="bg-bg-secondary border border-border-primary rounded px-2"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={liveCooldownSec > 0}
              >
                <option value="">Все приоритеты</option>
                {priorities.map((item) => (
                  <option key={item.id ?? item.key} value={item.key ?? item.id}>
                    {item.display}
                  </option>
                ))}
              </select>
              <input
                className="bg-bg-secondary border border-border-primary rounded px-2"
                placeholder="Исполнитель"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                disabled={liveCooldownSec > 0}
              />
              <div className="relative col-span-2">
                <Search size={14} className="absolute left-2 top-2.5" />
                <input
                  className="w-full bg-bg-secondary border border-border-primary rounded py-1.5 pl-7"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Поиск по списку"
                />
                <button
                  className="absolute right-2 top-2"
                  onClick={() => void manualRefresh()}
                  disabled={refreshDisabled}
                  aria-label="Обновить Трекер"
                  title={
                    liveCooldownSec > 0
                      ? `Слишком много запросов. Повторим через ${liveCooldownSec} сек.`
                      : "Обновить"
                  }
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              {shownIssues.map((issue) => (
                <button
                  key={issue.key}
                  className={`w-full text-left p-3 border-b border-border-primary hover:bg-bg-hover ${
                    selected?.key === issue.key ? "bg-accent/10" : ""
                  }`}
                  onClick={() => openIssue(issue)}
                >
                  <div className="text-xs text-text-tertiary">
                    {issue.key} · {issue.status?.display}
                  </div>
                  <div className="mt-1">{issue.summary}</div>
                  <div className="text-xs text-text-tertiary mt-1">
                    {issue.priority?.display} · {issue.assignee?.display ?? "Не назначена"}
                  </div>
                </button>
              ))}
            </div>
          </section>
          <section className="border border-border-primary rounded-lg overflow-auto p-5">
            {selected ? (
              <>
                <div className="text-sm text-accent">{selected.key}</div>
                <h2 className="text-xl font-semibold mt-1">{selected.summary}</h2>
                <p className="whitespace-pre-wrap text-sm text-text-secondary my-4">
                  {selected.description || "Описание отсутствует"}
                </p>
                <div className="flex flex-wrap gap-2 mb-5">
                  <button
                    className="btn-secondary px-3 py-1.5"
                    onClick={editIssue}
                    disabled={writesDisabled}
                    title={writeDisabledTitle}
                  >
                    Редактировать
                  </button>
                  <button
                    className="btn-secondary px-3 py-1.5"
                    onClick={changePriority}
                    disabled={writesDisabled}
                    title={writeDisabledTitle}
                  >
                    Приоритет: {selected.priority?.display ?? "—"}
                  </button>
                  {transitions.map((transition) => (
                    <button
                      className="btn-secondary px-3 py-1.5"
                      key={transition.id}
                      onClick={() => changeTransition(transition.id)}
                      disabled={writesDisabled}
                      title={writeDisabledTitle}
                    >
                      {transition.display}
                    </button>
                  ))}
                </div>
                <div className="border-t border-border-primary py-4">
                  <div className="flex justify-between">
                    <h3 className="font-medium">Вложения</h3>
                    <button
                      className="text-accent disabled:opacity-50"
                      onClick={attachFile}
                      disabled={writesDisabled}
                      title={writeDisabledTitle}
                    >
                      Добавить файл
                    </button>
                  </div>
                  {attachments.map((item) => (
                    <div className="text-sm mt-2" key={item.id}>
                      {item.name}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-border-primary pt-4">
                  <h3 className="font-medium">Комментарии</h3>
                  <button
                    className="flex gap-2 text-accent disabled:opacity-50"
                    onClick={addComment}
                    disabled={writesDisabled}
                    title={writeDisabledTitle}
                  >
                    <MessageSquarePlus size={16} />
                    Добавить
                  </button>
                </div>
                {comments.map((comment) => (
                  <div key={comment.id} className="mt-3 bg-bg-secondary rounded-md p-3">
                    <div className="text-xs text-text-tertiary">{comment.createdBy?.display}</div>
                    <div className="text-sm mt-1 whitespace-pre-wrap">{comment.text}</div>
                  </div>
                ))}
              </>
            ) : (
              <div className="h-full grid place-items-center text-text-tertiary">Выберите задачу</div>
            )}
          </section>
        </div>
      )}
    </ServicePageShell>
  );
}
