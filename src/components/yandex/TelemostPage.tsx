import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, Filter, Plus, RefreshCw, Search, Video } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useAccountStore } from "@/stores/accountStore";
import { getCalendarEventsInRange } from "@/services/db/calendarEvents";
import { createTelemostConference, type TelemostConference } from "@/services/yandex360/telemost";
import { cefCreate, cefInitialize, cefNavigate, cefPermissionResponse, cefSetBounds, cefSetVisible, type CefEvent } from "@/services/cef";
import { ServicePageShell } from "./ServicePageShell";

const CREATED_KEY = "office360_telemost_conferences";
const VISITED_KEY = "office360_telemost_visited";
const TELEMost_URL = /https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/\d+/gi;

type MeetingSource = "created" | "invited" | "visited";
interface MeetingEntry {
  id: string;
  title: string;
  joinUrl: string;
  source: MeetingSource;
  startTime?: number;
  lastOpenedAt?: number;
}

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}

function meetingId(url: string): string {
  return url.match(/\/j\/(\d+)/)?.[1] ?? url;
}

function mergeMeetings(items: MeetingEntry[]): MeetingEntry[] {
  const merged = new Map<string, MeetingEntry>();
  for (const item of items) {
    const current = merged.get(item.joinUrl);
    if (!current || item.source === "created" || (item.startTime ?? 0) > (current.startTime ?? 0)) merged.set(item.joinUrl, { ...current, ...item });
  }
  return [...merged.values()].sort((a, b) => (b.startTime ?? b.lastOpenedAt ?? 0) - (a.startTime ?? a.lastOpenedAt ?? 0));
}

export function TelemostPage() {
  const accountId = useAccountStore((state) => state.activeAccountId);
  const hostRef = useRef<HTMLDivElement>(null);
  const [created, setCreated] = useState<TelemostConference[]>(() => readJson(CREATED_KEY, []));
  const [calendarMeetings, setCalendarMeetings] = useState<MeetingEntry[]>([]);
  const [visited, setVisited] = useState<MeetingEntry[]>(() => readJson(VISITED_KEY, []));
  const [selectedUrl, setSelectedUrl] = useState("https://telemost.yandex.ru/");
  const [filter, setFilter] = useState<"all" | MeetingSource>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { localStorage.setItem(CREATED_KEY, JSON.stringify(created)); }, [created]);
  useEffect(() => { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); }, [visited]);

  useEffect(() => {
    if (!accountId) { setCalendarMeetings([]); return; }
    const now = Date.now();
    void getCalendarEventsInRange(accountId, now - 730 * 86400000, now + 730 * 86400000)
      .then((events) => {
        const result: MeetingEntry[] = [];
        for (const event of events) {
          const text = [event.description, event.location, event.html_link, event.ical_data].filter(Boolean).join(" ");
          for (const match of text.matchAll(TELEMost_URL)) {
            const joinUrl = match[0].replace(/[),.;]+$/, "");
            result.push({ id: meetingId(joinUrl), title: event.summary || `Встреча ${meetingId(joinUrl)}`, joinUrl, source: "invited", startTime: event.start_time });
          }
        }
        setCalendarMeetings(mergeMeetings(result));
      })
      .catch((reason) => setError(`Не удалось прочитать встречи календаря: ${String(reason)}`));
  }, [accountId]);

  useEffect(() => {
    let alive = true;
    void cefInitialize().then(() => cefCreate(selectedUrl)).catch((reason) => alive && setError(`CEF недоступен: ${String(reason)}`));
    const unlisten = listen<CefEvent>("cef-event", (event) => {
      const { type, payload } = event.payload;
      if (type === "loading" && typeof payload.loading === "boolean") setLoading(payload.loading);
      if (type === "navigation" && typeof payload.url === "string") {
        setSelectedUrl(payload.url);
        if (/^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/\d+/.test(payload.url)) {
          const entry: MeetingEntry = { id: meetingId(payload.url), title: `Встреча ${meetingId(payload.url)}`, joinUrl: payload.url, source: "visited", lastOpenedAt: Date.now() };
          setVisited((items) => mergeMeetings([entry, ...items]).slice(0, 100));
        }
      }
      if (type === "error" && typeof payload.message === "string" && payload.message !== "ERR_ABORTED") setError(payload.message);
      if (type === "permission-request" && typeof payload.id === "number" && typeof payload.origin === "string") {
        const allow = window.confirm(`Разрешить камеру и микрофон для ${payload.origin}?`);
        void cefPermissionResponse(payload.id, allow);
      }
    });
    return () => { alive = false; void cefSetVisible(false); void unlisten.then((fn) => fn()); };
  }, []);

  const syncBounds = useCallback(() => {
    const element = hostRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    void cefSetBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, deviceScaleFactor: window.devicePixelRatio || 1 });
  }, []);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver(syncBounds);
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);
    syncBounds();
    void cefSetVisible(true);
    return () => { observer.disconnect(); window.removeEventListener("resize", syncBounds); window.removeEventListener("scroll", syncBounds, true); void cefSetVisible(false); };
  }, [syncBounds]);

  const meetings = useMemo(() => {
    const fromCreated: MeetingEntry[] = created.map((item) => ({ id: item.id, title: `Созданная встреча ${item.id}`, joinUrl: item.joinUrl, source: "created" }));
    const normalized = query.trim().toLowerCase();
    return mergeMeetings([...fromCreated, ...calendarMeetings, ...visited]).filter((item) =>
      (filter === "all" || item.source === filter) && (!normalized || `${item.title} ${item.joinUrl}`.toLowerCase().includes(normalized)),
    );
  }, [calendarMeetings, created, filter, query, visited]);

  const openMeeting = (meeting: MeetingEntry) => {
    setSelectedUrl(meeting.joinUrl);
    setError(null);
    void cefNavigate(meeting.joinUrl);
  };

  const create = async () => {
    try {
      setError(null);
      const conference = await createTelemostConference({ accountId, waitingRoomLevel: "PUBLIC", cohostEmails: [], autoSummarization: false });
      setCreated((items) => [conference, ...items.filter((item) => item.id !== conference.id)]);
      openMeeting({ id: conference.id, title: `Созданная встреча ${conference.id}`, joinUrl: conference.joinUrl, source: "created" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <ServicePageShell title="Яндекс Телемост" description="Встречи и встроенный Chromium Embedded Framework" actions={<button className="btn-primary px-3 py-2 flex gap-2" onClick={create}><Plus size={16}/>Новая встреча</button>}>
    {error && <div className="mb-3 rounded-md bg-danger/10 text-danger p-3 text-sm flex items-center justify-between"><span>{error}</span><button onClick={() => setError(null)}>Закрыть</button></div>}
    <div className="h-full min-h-[650px] grid grid-cols-[300px_minmax(0,1fr)] gap-3">
      <aside className="border border-border-primary rounded-lg overflow-hidden flex flex-col bg-bg-primary">
        <div className="p-3 border-b border-border-primary"><div className="font-medium">Встречи</div><div className="mt-2 relative"><Search size={14} className="absolute left-2 top-2.5 text-text-tertiary"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск встреч" className="w-full rounded border border-border-primary bg-bg-secondary py-2 pl-8 pr-2 text-sm"/></div></div>
        <div className="p-2 border-b border-border-primary flex gap-1 overflow-x-auto">
          <Filter size={14} className="m-2 text-text-tertiary shrink-0"/>
          {([['all','Все'],['created','Созданные'],['invited','Приглашения'],['visited','Недавние']] as const).map(([value,label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded px-2 py-1 text-xs whitespace-nowrap ${filter === value ? 'bg-accent text-white' : 'bg-bg-secondary hover:bg-bg-hover'}`}>{label}</button>)}
        </div>
        <div className="overflow-auto flex-1">{meetings.length === 0 ? <div className="p-4 text-sm text-text-tertiary">Встречи появятся после создания, приглашения в календаре или первого открытия ссылки.</div> : meetings.map((meeting) => <button key={`${meeting.source}:${meeting.joinUrl}`} className={`w-full text-left p-3 border-b border-border-primary hover:bg-bg-hover ${selectedUrl === meeting.joinUrl ? 'bg-accent/10' : ''}`} onClick={() => openMeeting(meeting)}><div className="flex gap-2 items-center"><Video size={15} className="shrink-0"/><span className="truncate font-medium">{meeting.title}</span></div><div className="text-xs text-text-tertiary mt-1">{meeting.source === 'created' ? 'Создана вами' : meeting.source === 'invited' ? 'Из календаря' : 'Вы открывали'}</div>{meeting.startTime && <div className="text-xs text-text-tertiary mt-1">{new Date(meeting.startTime).toLocaleString('ru-RU')}</div>}</button>)}</div>
      </aside>
      <section className="relative border border-border-primary rounded-lg overflow-hidden min-w-0 bg-black">
        <div ref={hostRef} className="absolute inset-0 bg-black"/>
        <div className="absolute right-3 top-3 z-10 flex gap-2 pointer-events-auto">
          {loading && <span className="rounded bg-black/70 px-2 py-1 text-xs text-white">Загрузка…</span>}
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Обновить" onClick={() => cefNavigate(selectedUrl)}><RefreshCw size={15}/></button>
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Копировать ссылку" onClick={() => navigator.clipboard.writeText(selectedUrl)}><Copy size={15}/></button>
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Открыть ссылку в системном браузере" onClick={() => window.open(selectedUrl, '_blank')}><ExternalLink size={15}/></button>
        </div>
      </section>
    </div>
  </ServicePageShell>;
}
