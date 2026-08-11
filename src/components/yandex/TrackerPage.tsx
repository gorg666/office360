import { useCallback, useEffect, useState } from "react";
import { MessageSquarePlus, Plus, RefreshCw, Search } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useAccountStore } from "@/stores/accountStore";
import { authorizeYandexServices, getYandexContext, getYandexServiceClientId, getStoredYandexOrgId, listYandexOrganizations, setStoredYandexOrgId } from "@/services/yandex/accountApi";
import { addTrackerComment, createTrackerIssue, executeTrackerTransition, getTrackerIssue, listTrackerAttachments, listTrackerComments, listTrackerPriorities, listTrackerQueues, listTrackerStatuses, listTrackerTransitions, searchTrackerIssues, updateTrackerIssue, uploadTrackerAttachment, type TrackerAttachment, type TrackerComment, type TrackerIssue, type TrackerQueue, type TrackerRef, type TrackerTransition } from "@/services/yandex/tracker";
import { ServicePageShell } from "./ServicePageShell";

export function TrackerPage() {
  const accountId = useAccountStore((state) => state.activeAccountId);
  const [orgId, setOrgId] = useState("");
  const [queues, setQueues] = useState<TrackerQueue[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [selected, setSelected] = useState<TrackerIssue | null>(null);
  const [comments, setComments] = useState<TrackerComment[]>([]);
  const [transitions, setTransitions] = useState<TrackerTransition[]>([]);
  const [queue, setQueue] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<TrackerRef[]>([]); const [priorities, setPriorities] = useState<TrackerRef[]>([]);
  const [status, setStatus] = useState(""); const [priority, setPriority] = useState(""); const [assignee, setAssignee] = useState("");
  const [attachments, setAttachments] = useState<TrackerAttachment[]>([]);
  const [reauthorizing, setReauthorizing] = useState(false);

  const initialize = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      const context = await getYandexContext(accountId);
      let stored = await getStoredYandexOrgId(context.account.id);
      if (!stored) {
        const organizations = await listYandexOrganizations(accountId);
        if (organizations.length === 1) { stored = String(organizations[0]!.id); await setStoredYandexOrgId(context.account.id, stored); }
      }
      setOrgId(stored ?? "");
      if (stored) {
        const [loadedQueues, loadedStatuses, loadedPriorities] = await Promise.all([listTrackerQueues(accountId), listTrackerStatuses(accountId), listTrackerPriorities(accountId)]); setQueues(loadedQueues); setStatuses(loadedStatuses); setPriorities(loadedPriorities);
        const filter: Record<string, unknown> = queue ? { queue } : { assignee: "me()" }; if (status) filter.status = status; if (priority) filter.priority = priority; if (assignee.trim()) filter.assignee = assignee.trim();
        setIssues(await searchTrackerIssues(accountId, filter));
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [accountId, queue, status, priority, assignee]);
  useEffect(() => { void initialize(); }, [initialize]);

  const reconnect = async () => {
    if (!accountId) return;
    setReauthorizing(true); setError(null);
    try {
      const storedClientId = await getYandexServiceClientId(accountId);
      const clientId = window.prompt("Client ID отдельного API OAuth-приложения Яндекса", storedClientId ?? "");
      if (!clientId?.trim()) return;
      await authorizeYandexServices(accountId, clientId);
      await initialize();
    }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setReauthorizing(false); }
  };

  const saveOrg = async () => {
    if (!accountId || !orgId.trim()) return;
    const { account } = await getYandexContext(accountId); await setStoredYandexOrgId(account.id, orgId); await initialize();
  };
  const openIssue = async (issue: TrackerIssue) => {
    try { const full = await getTrackerIssue(accountId, issue.key); setSelected(full); const [nextComments, nextTransitions, nextAttachments] = await Promise.all([listTrackerComments(accountId, issue.key), listTrackerTransitions(accountId, issue.key), listTrackerAttachments(accountId, issue.key)]); setComments(nextComments); setTransitions(nextTransitions); setAttachments(nextAttachments); } catch (err) { setError(String(err)); }
  };
  const createIssue = async () => {
    const summary = window.prompt("Название задачи"); if (!summary?.trim()) return;
    const queueKey = queue || queues[0]?.key; if (!queueKey) { setError("Выберите доступную очередь."); return; }
    try { await createTrackerIssue(accountId, { summary: summary.trim(), queue: queueKey }); await initialize(); } catch (err) { setError(String(err)); }
  };
  const addComment = async () => {
    if (!selected) return; const text = window.prompt("Комментарий"); if (!text?.trim()) return;
    await addTrackerComment(accountId, selected.key, text.trim()); setComments(await listTrackerComments(accountId, selected.key));
  };
  const changeTransition = async (id: string) => {
    if (!selected) return; await executeTrackerTransition(accountId, selected.key, id); await openIssue(selected); await initialize();
  };
  const changePriority = async () => {
    if (!selected) return; const priority = window.prompt("Ключ приоритета", selected.priority?.key ?? "normal"); if (!priority) return;
    const updated = await updateTrackerIssue(accountId, selected.key, { priority }); setSelected(updated); await initialize();
  };
  const editIssue = async () => { if (!selected) return; const summary = window.prompt("Название", selected.summary); if (!summary) return; const description = window.prompt("Описание", selected.description ?? ""); const deadline = window.prompt("Срок YYYY-MM-DD", selected.deadline ?? ""); const updated = await updateTrackerIssue(accountId, selected.key, { summary, description: description ?? selected.description, deadline: deadline || null }); setSelected(updated); await initialize(); };
  const attachFile = async () => { if (!selected) return; const path = await open({ multiple: false, directory: false }); if (!path) return; const data = await readFile(path); const name = path.replace(/\\/g, "/").split("/").pop()!; await uploadTrackerAttachment(accountId, selected.key, name, data); setAttachments(await listTrackerAttachments(accountId, selected.key)); };
  const shownIssues = issues.filter((issue) => !query || `${issue.key} ${issue.summary}`.toLowerCase().includes(query.toLowerCase()));

  return <ServicePageShell title="Яндекс Трекер" description="Задачи организации" actions={<button className="btn-primary px-3 py-2 flex gap-2" onClick={createIssue}><Plus size={16}/>Создать задачу</button>}>
    {error && <div className="mb-4 rounded-md bg-danger/10 text-danger p-3 text-sm flex items-center justify-between gap-3"><span>{error}</span><button className="btn-secondary shrink-0 px-3 py-1.5" disabled={reauthorizing} onClick={reconnect}>{reauthorizing ? "Авторизация…" : "Выдать доступ"}</button></div>}
    {!orgId && <div className="max-w-lg border border-border-primary rounded-lg p-5"><h2 className="font-medium mb-2">Организация Трекера</h2><p className="text-sm text-text-tertiary mb-3">Автоматически определить организацию не удалось. Укажите X-Org-ID.</p><div className="flex gap-2"><input className="flex-1 bg-bg-secondary border border-border-primary rounded-md px-3 py-2" value={orgId} onChange={(e) => setOrgId(e.target.value)}/><button className="btn-primary px-4" onClick={saveOrg}>Сохранить</button></div></div>}
    {orgId && <div className="h-full min-h-[500px] grid grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.4fr)] gap-4">
      <section className="border border-border-primary rounded-lg overflow-hidden flex flex-col">
        <div className="p-3 border-b border-border-primary grid grid-cols-2 gap-2"><select className="bg-bg-secondary border border-border-primary rounded px-2" value={queue} onChange={(e) => setQueue(e.target.value)}><option value="">Мои задачи</option>{queues.map((item) => <option key={item.id ?? item.key} value={item.key}>{item.name ?? item.display ?? item.key}</option>)}</select><select className="bg-bg-secondary border border-border-primary rounded px-2" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все статусы</option>{statuses.map((item) => <option key={item.id ?? item.key} value={item.key ?? item.id}>{item.display}</option>)}</select><select className="bg-bg-secondary border border-border-primary rounded px-2" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Все приоритеты</option>{priorities.map((item) => <option key={item.id ?? item.key} value={item.key ?? item.id}>{item.display}</option>)}</select><input className="bg-bg-secondary border border-border-primary rounded px-2" placeholder="Исполнитель" value={assignee} onChange={(e) => setAssignee(e.target.value)}/><div className="relative col-span-2"><Search size={14} className="absolute left-2 top-2.5"/><input className="w-full bg-bg-secondary border border-border-primary rounded py-1.5 pl-7" value={query} onChange={(e) => setQuery(e.target.value)}/><button className="absolute right-2 top-2" onClick={initialize}><RefreshCw size={16} className={loading ? "animate-spin" : ""}/></button></div></div>
        <div className="overflow-auto">{shownIssues.map((issue) => <button key={issue.key} className={`w-full text-left p-3 border-b border-border-primary hover:bg-bg-hover ${selected?.key === issue.key ? "bg-accent/10" : ""}`} onClick={() => openIssue(issue)}><div className="text-xs text-text-tertiary">{issue.key} · {issue.status?.display}</div><div className="mt-1">{issue.summary}</div><div className="text-xs text-text-tertiary mt-1">{issue.priority?.display} · {issue.assignee?.display ?? "Не назначена"}</div></button>)}</div>
      </section>
      <section className="border border-border-primary rounded-lg overflow-auto p-5">{selected ? <><div className="text-sm text-accent">{selected.key}</div><h2 className="text-xl font-semibold mt-1">{selected.summary}</h2><p className="whitespace-pre-wrap text-sm text-text-secondary my-4">{selected.description || "Описание отсутствует"}</p><div className="flex flex-wrap gap-2 mb-5"><button className="btn-secondary px-3 py-1.5" onClick={editIssue}>Редактировать</button><button className="btn-secondary px-3 py-1.5" onClick={changePriority}>Приоритет: {selected.priority?.display ?? "—"}</button>{transitions.map((transition) => <button className="btn-secondary px-3 py-1.5" key={transition.id} onClick={() => changeTransition(transition.id)}>{transition.display}</button>)}</div><div className="border-t border-border-primary py-4"><div className="flex justify-between"><h3 className="font-medium">Вложения</h3><button className="text-accent" onClick={attachFile}>Добавить файл</button></div>{attachments.map((item) => <div className="text-sm mt-2" key={item.id}>{item.name}</div>)}</div><div className="flex items-center justify-between border-t border-border-primary pt-4"><h3 className="font-medium">Комментарии</h3><button className="flex gap-2 text-accent" onClick={addComment}><MessageSquarePlus size={16}/>Добавить</button></div>{comments.map((comment) => <div key={comment.id} className="mt-3 bg-bg-secondary rounded-md p-3"><div className="text-xs text-text-tertiary">{comment.createdBy?.display}</div><div className="text-sm mt-1 whitespace-pre-wrap">{comment.text}</div></div>)}</> : <div className="h-full grid place-items-center text-text-tertiary">Выберите задачу</div>}</section>
    </div>}
  </ServicePageShell>;
}
