import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Code2, Copy, Plus, RefreshCw, Video } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useAccountStore } from "@/stores/accountStore";
import { createTelemostConference, getTelemostConference, updateTelemostConference, type TelemostConference } from "@/services/yandex360/telemost";
import { cefBack, cefCreate, cefDomCommand, cefForward, cefInitialize, cefNavigate, cefPermissionResponse, cefReload, cefSetBounds, cefSetVisible, type CefEvent, type DomCommandResult } from "@/services/cef";
import { ServicePageShell } from "./ServicePageShell";

const STORAGE_KEY = "office360_telemost_conferences";
function restore(): TelemostConference[] { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; } }
function persist(items: TelemostConference[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }

export function TelemostPage() {
  const accountId = useAccountStore((state) => state.activeAccountId);
  const hostRef = useRef<HTMLDivElement>(null);
  const [conferences, setConferences] = useState<TelemostConference[]>(restore);
  const [selected, setSelected] = useState<TelemostConference | null>(null);
  const [url, setUrl] = useState("https://telemost.yandex.ru/");
  const [error, setError] = useState<string | null>(null);
  const [cefStatus, setCefStatus] = useState("Инициализация Chromium...");
  const [domResult, setDomResult] = useState<DomCommandResult | null>(null);

  useEffect(() => { persist(conferences); }, [conferences]);
  useEffect(() => {
    let alive = true;
    void cefInitialize().then(() => cefCreate(url)).then(() => alive && setCefStatus("Chromium готов")).catch((err) => alive && setCefStatus(`CEF недоступен: ${String(err)}`));
    const unlisten = listen<CefEvent>("cef-event", (event) => {
      const { type, payload } = event.payload;
      if (type === "navigation" && typeof payload.url === "string") setUrl(payload.url);
      if ((type === "ready" || type === "error") && typeof payload.message === "string") setCefStatus(payload.message);
      if (type === "dom-result") setDomResult(payload as unknown as DomCommandResult);
      if (type === "permission-request" && typeof payload.id === "number" && typeof payload.origin === "string") {
        const allow = window.confirm(`Разрешить камеру и микрофон для ${payload.origin}?`);
        void cefPermissionResponse(payload.id, allow);
      }
    });
    return () => { alive = false; void cefSetVisible(false); void unlisten.then((fn) => fn()); };
  }, []);

  const syncBounds = useCallback(() => {
    const element = hostRef.current; if (!element) return;
    const rect = element.getBoundingClientRect(); const scaleFactor = window.devicePixelRatio || 1;
    void cefSetBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, deviceScaleFactor: scaleFactor });
  }, []);
  useEffect(() => {
    const element = hostRef.current; if (!element) return;
    const observer = new ResizeObserver(syncBounds); observer.observe(element);
    window.addEventListener("resize", syncBounds); window.addEventListener("scroll", syncBounds, true);
    syncBounds(); void cefSetVisible(true);
    return () => { observer.disconnect(); window.removeEventListener("resize", syncBounds); window.removeEventListener("scroll", syncBounds, true); void cefSetVisible(false); };
  }, [syncBounds]);

  const create = async () => {
    try {
      const waitingRoomLevel = (window.prompt("Комната ожидания: PUBLIC, ORGANIZATION или ADMINS", "PUBLIC") || "PUBLIC") as "PUBLIC" | "ORGANIZATION" | "ADMINS";
      const cohostEmails = (window.prompt("Соорганизаторы через запятую (необязательно)", "") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      const autoSummarization = window.confirm("Включить автоматическое конспектирование?");
      const withLiveStream = window.confirm("Создать трансляцию? Доступность зависит от тарифа.");
      const conference = await createTelemostConference({ accountId, waitingRoomLevel, cohostEmails, autoSummarization, liveStream: withLiveStream ? { accessLevel: "PUBLIC", title: "Трансляция Office360" } : undefined });
      setConferences((items) => [conference, ...items.filter((item) => item.id !== conference.id)]); setSelected(conference); setUrl(conference.joinUrl); await cefNavigate(conference.joinUrl);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const refreshConference = async (conference: TelemostConference) => {
    try { const value = await getTelemostConference(accountId, conference.id); setConferences((items) => items.map((item) => item.id === value.id ? value : item)); setSelected(value); } catch (err) { setError(String(err)); }
  };
  const updateWaitingRoom = async () => {
    if (!selected) return; const level = window.prompt("PUBLIC, ORGANIZATION или ADMINS", selected.waitingRoomLevel ?? "PUBLIC") as "PUBLIC" | "ORGANIZATION" | "ADMINS" | null; if (!level) return;
    try { const value = await updateTelemostConference({ accountId, id: selected.id, waitingRoomLevel: level }); setSelected(value); setConferences((items) => items.map((item) => item.id === value.id ? value : item)); } catch (err) { setError(String(err)); }
  };
  const runInspector = async () => { try { const submission = await cefDomCommand({ type: "inspect", enabled: true }); setCefStatus(`DOM-команда ${submission.accepted ? "принята" : "отклонена"}`); } catch (err) { setError(String(err)); } };

  return <ServicePageShell title="Яндекс Телемост" description="Встречи и встроенный Chromium Embedded Framework" actions={<button className="btn-primary px-3 py-2 flex gap-2" onClick={create}><Plus size={16}/>Новая встреча</button>}>
    {error && <div className="mb-3 rounded-md bg-danger/10 text-danger p-3 text-sm">{error}</div>}
    <div className="h-full min-h-[650px] grid grid-cols-[260px_1fr] gap-3">
      <aside className="border border-border-primary rounded-lg overflow-auto"><div className="p-3 font-medium border-b border-border-primary">Сохранённые встречи</div>{conferences.map((conference) => <button key={conference.id} className={`w-full text-left p-3 border-b border-border-primary hover:bg-bg-hover ${selected?.id === conference.id ? "bg-accent/10" : ""}`} onClick={() => { setSelected(conference); setUrl(conference.joinUrl); void cefNavigate(conference.joinUrl); }}><div className="flex gap-2 items-center"><Video size={15}/><span className="truncate">{conference.id}</span></div><div className="text-xs text-text-tertiary mt-1 truncate">{conference.waitingRoomLevel ?? "Встреча"}</div></button>)}</aside>
      <section className="border border-border-primary rounded-lg overflow-hidden flex flex-col min-w-0">
        <div className="p-2 border-b border-border-primary flex gap-2 items-center bg-bg-secondary"><button onClick={cefBack}><ArrowLeft size={16}/></button><button onClick={cefForward}><ArrowRight size={16}/></button><button onClick={cefReload}><RefreshCw size={16}/></button><input className="flex-1 bg-bg-primary border border-border-primary rounded px-2 py-1 text-sm" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cefNavigate(url)}/><button title="DOM-инспектор" onClick={runInspector}><Code2 size={17}/></button>{selected && <><button title="Обновить данные API" onClick={() => refreshConference(selected)}><RefreshCw size={16}/></button><button className="text-xs" onClick={updateWaitingRoom}>Доступ</button><button title="Копировать ссылку" onClick={() => navigator.clipboard.writeText(selected.joinUrl)}><Copy size={16}/></button></>}</div>
        <div className="px-3 py-1 text-xs text-text-tertiary border-b border-border-primary">{cefStatus}{domResult && ` · DOM: ${domResult.ok ? "готов" : domResult.error}`}</div>
        <div ref={hostRef} className="flex-1 min-h-[540px] bg-black" />
      </section>
    </div>
  </ServicePageShell>;
}
