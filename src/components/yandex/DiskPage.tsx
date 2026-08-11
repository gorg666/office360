import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronRight, Download, File, Folder, FolderPlus, Link, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { createDiskFolder, deleteDiskResource, getDiskDownloadUrl, getDiskQuota, getDiskResource, listDiskResources, moveDiskResource, publishDiskResource, searchDisk, unpublishDiskResource, uploadDiskFile, type DiskResource } from "@/services/yandex/disk";
import { authorizeYandexServices, getYandexServiceClientId } from "@/services/yandex/accountApi";
import { getAccount } from "@/services/db/accounts";
import { ServicePageShell } from "./ServicePageShell";

function joinPath(parent: string, name: string) { return `${parent.replace(/\/$/, "")}/${name}`; }
function formatSize(size?: number) {
  if (size == null) return "";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = size, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function DiskPage() {
  const accountId = useAccountStore((state) => state.activeAccountId);
  const activeAccount = useAccountStore((state) => state.accounts.find((item) => item.id === state.activeAccountId) ?? null);
  const [serviceAccountId, setServiceAccountId] = useState<string | null>(null);
  const [accountChecking, setAccountChecking] = useState(true);
  const [path, setPath] = useState("disk:/");
  const [items, setItems] = useState<DiskResource[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState("name");
  const [quota, setQuota] = useState<{ used: number; total: number } | null>(null);
  const [reauthorizing, setReauthorizing] = useState(false);

  useEffect(() => {
    let current = true;
    setAccountChecking(true);
    setServiceAccountId(null);
    setItems([]);
    setQuota(null);
    setTotal(0);
    setOffset(0);
    setPath("disk:/");
    setQuery("");
    setError(null);
    if (!accountId) {
      setAccountChecking(false);
      return () => { current = false; };
    }
    void getAccount(accountId).then((account) => {
      if (!current) return;
      setServiceAccountId(account?.oauth_provider === "yandex" && account.auth_method === "oauth2" ? accountId : null);
      setAccountChecking(false);
    }).catch((reason) => {
      if (!current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setAccountChecking(false);
    });
    return () => { current = false; };
  }, [accountId]);

  const load = useCallback(async () => {
    if (!serviceAccountId) return;
    const requestedAccountId = serviceAccountId;
    setLoading(true); setError(null);
    try {
      const listing = query.trim() ? await searchDisk(requestedAccountId, query.trim(), offset) : await listDiskResources(requestedAccountId, path, offset, 100, sort);
      if (useAccountStore.getState().activeAccountId !== requestedAccountId) return;
      setItems(listing.items); setTotal(listing.total);
      const disk = await getDiskQuota(requestedAccountId);
      if (useAccountStore.getState().activeAccountId === requestedAccountId) setQuota({ used: disk.used_space, total: disk.total_space });
    }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [serviceAccountId, path, query, offset, sort]);
  useEffect(() => { void load(); }, [load]);

  const reconnect = async () => {
    if (!accountId) return;
    setReauthorizing(true); setError(null);
    try {
      const storedClientId = await getYandexServiceClientId(accountId);
      const clientId = window.prompt("Client ID отдельного API OAuth-приложения Яндекса", storedClientId ?? "");
      if (!clientId?.trim()) return;
      await authorizeYandexServices(accountId, clientId);
      await load();
    }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setReauthorizing(false); }
  };

  const crumbs = useMemo(() => {
    const parts = path.replace(/^disk:\/?/, "").split("/").filter(Boolean);
    return [{ label: "Диск", path: "disk:/" }, ...parts.map((label, index) => ({ label, path: `disk:/${parts.slice(0, index + 1).join("/")}` }))];
  }, [path]);

  const createFolder = async () => {
    const name = window.prompt("Название новой папки");
    if (!name?.trim()) return;
    try { await createDiskFolder(accountId, joinPath(path, name.trim())); await load(); } catch (err) { setError(String(err)); }
  };
  const upload = async () => {
    const selected = await open({ multiple: false, directory: false });
    if (!selected) return;
    try {
      setLoading(true);
      const data = await readFile(selected);
      const name = selected.replace(/\\/g, "/").split("/").pop()!;
      await uploadDiskFile(accountId, joinPath(path, name), data);
      await load();
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  };
  const itemAction = async (item: DiskResource, action: "download" | "rename" | "delete" | "publish") => {
    try {
      if (action === "download") await openUrl(await getDiskDownloadUrl(accountId, item.path));
      if (action === "rename") {
        const name = window.prompt("Новое имя", item.name);
        if (name?.trim() && name.trim() !== item.name) await moveDiskResource(accountId, item.path, joinPath(path, name.trim()));
      }
      if (action === "delete" && window.confirm(`Переместить «${item.name}» в корзину?`)) await deleteDiskResource(accountId, item.path);
      if (action === "publish") {
        if (item.public_url) await unpublishDiskResource(accountId, item.path);
        else { await publishDiskResource(accountId, item.path); const resource = await getDiskResource(accountId, item.path); if (resource.public_url) await navigator.clipboard.writeText(resource.public_url); }
      }
      if (action !== "download") await load();
    } catch (err) { setError(String(err)); }
  };

  if (!accountChecking && !serviceAccountId) {
    return <ServicePageShell title="Яндекс Диск" description="Файлы активного Яндекс-аккаунта">
      <div className="rounded-lg border border-border-primary p-8 text-center">
        <div className="font-medium">Яндекс Диск недоступен для активного аккаунта</div>
        <div className="mt-2 text-sm text-text-tertiary">{activeAccount?.email ?? "Аккаунт не выбран"} не подключён через Яндекс ID. Выберите подключённый Яндекс-аккаунт.</div>
      </div>
    </ServicePageShell>;
  }

  return (
    <ServicePageShell title="Яндекс Диск" description="Файлы активного Яндекс-аккаунта" actions={
      <div className="flex gap-2"><button className="btn-secondary flex gap-2 px-3 py-2" onClick={createFolder}><FolderPlus size={16}/>Папка</button><button className="btn-primary flex gap-2 px-3 py-2" onClick={upload}><Upload size={16}/>Загрузить</button></div>
    }>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center flex-1 min-w-0 text-sm">{crumbs.map((crumb, index) => <span className="flex items-center" key={crumb.path}><button className="text-accent hover:underline" onClick={() => { setQuery(""); setPath(crumb.path); }}>{crumb.label}</button>{index < crumbs.length - 1 && <ChevronRight size={14}/>}</span>)}</div>
        {quota && <span className="text-xs text-text-tertiary">{formatSize(quota.used)} / {formatSize(quota.total)}</span>}
        <select className="bg-bg-secondary border border-border-primary rounded-md py-2 px-2 text-sm" value={sort} onChange={(e) => { setOffset(0); setSort(e.target.value); }}><option value="name">По имени</option><option value="-modified">Сначала новые</option><option value="modified">Сначала старые</option><option value="-size">По размеру</option></select>
        <div className="relative"><Search size={15} className="absolute left-2.5 top-2.5 text-text-tertiary"/><input className="bg-bg-secondary border border-border-primary rounded-md py-2 pl-8 pr-3 text-sm" placeholder="Поиск на Диске" value={query} onChange={(e) => { setOffset(0); setQuery(e.target.value); }}/></div>
        <button className="p-2" title="Обновить" onClick={load}><RefreshCw size={17} className={loading ? "animate-spin" : ""}/></button>
      </div>
      {total > 100 && <div className="mt-3 flex justify-end items-center gap-3 text-sm"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Назад</button><span>{offset + 1}–{Math.min(total, offset + items.length)} из {total}</span><button disabled={offset + items.length >= total} onClick={() => setOffset(offset + 100)}>Далее</button></div>}
      {error && <div className="mb-4 rounded-md bg-danger/10 text-danger p-3 text-sm flex items-center justify-between gap-3"><span>{error}</span><button className="btn-secondary shrink-0 px-3 py-1.5" disabled={reauthorizing} onClick={reconnect}>{reauthorizing ? "Авторизация…" : "Выдать доступ"}</button></div>}
      <div className="border border-border-primary rounded-lg overflow-hidden">
        {items.map((item) => <div key={item.path} className="group flex items-center gap-3 px-4 py-3 border-b last:border-0 border-border-primary hover:bg-bg-hover">
          <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onDoubleClick={() => item.type === "dir" && setPath(item.path)}><span className="text-accent">{item.type === "dir" ? <Folder size={21}/> : <File size={21}/>}</span><span className="truncate">{item.name}</span></button>
          <span className="text-xs text-text-tertiary w-24 text-right">{formatSize(item.size)}</span>
          <div className="flex gap-1 opacity-60 group-hover:opacity-100">
            {item.type === "file" && <button className="p-1.5" title="Скачать" onClick={() => itemAction(item, "download")}><Download size={15}/></button>}
            <button className="p-1.5" title={item.public_url ? "Закрыть доступ" : "Опубликовать"} onClick={() => itemAction(item, "publish")}><Link size={15}/></button>
            <button className="p-1.5 text-xs" title="Переименовать" onClick={() => itemAction(item, "rename")}>Aa</button>
            <button className="p-1.5 text-danger" title="Удалить" onClick={() => itemAction(item, "delete")}><Trash2 size={15}/></button>
          </div>
        </div>)}
        {!loading && items.length === 0 && <div className="p-12 text-center text-text-tertiary">Здесь пока нет файлов</div>}
      </div>
    </ServicePageShell>
  );
}
