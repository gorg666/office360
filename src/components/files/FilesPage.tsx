import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  ArrowUpNarrowWide,
  Download,
  FolderOpen,
  Loader2,
  Mail,
  Search,
} from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import {
  countMailFilesAttachments,
  getMailFilesAttachments,
  type MailAttachmentFileRow,
  type MailFilesDirection,
  type MailFilesSortDir,
  type MailFilesSortKey,
  type MailFilesTypeCategory,
} from "@/services/db/attachments";
import { getEmailProvider } from "@/services/email/providerFactory";
import { navigateToLabel } from "@/router/navigate";
import { formatFileSize, getFileIcon } from "@/utils/fileTypeHelpers";
import { base64UrlToUint8Array } from "@/utils/base64url";
import { EmptyState } from "@/components/ui/EmptyState";

const PAGE_SIZE = 80;

function fileExtension(filename: string | null): string {
  if (!filename) return "—";
  const i = filename.lastIndexOf(".");
  if (i < 0 || i === filename.length - 1) return "—";
  return filename.slice(i + 1).toUpperCase();
}

function firstAddressPreview(list: string | null): string {
  if (!list?.trim()) return "—";
  const first = list.split(",")[0]?.trim();
  return first || "—";
}

function formatMessageDate(ts: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return "—";
  const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts;
  try {
    return new Date(ms).toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

type TabOpts = {
  sortKey: MailFilesSortKey;
  sortDir: MailFilesSortDir;
  search: string;
  category: MailFilesTypeCategory;
};

const defaultTabOpts = (): TabOpts => ({
  sortKey: "date",
  sortDir: "desc",
  search: "",
  category: "all",
});

export function FilesPage() {
  const { tab: tabParam } = useParams({ strict: false }) as { tab?: string };
  const direction: MailFilesDirection =
    tabParam === "outgoing" ? "outgoing" : "incoming";

  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const accountId = activeAccount?.id ?? null;
  const accountEmail = activeAccount?.email ?? "";

  const [incomingOpts, setIncomingOpts] = useState<TabOpts>(defaultTabOpts);
  const [outgoingOpts, setOutgoingOpts] = useState<TabOpts>(defaultTabOpts);
  const tabOpts = direction === "outgoing" ? outgoingOpts : incomingOpts;
  const setTabOpts = direction === "outgoing" ? setOutgoingOpts : setIncomingOpts;

  const [rows, setRows] = useState<MailAttachmentFileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const searchTrim = tabOpts.search.trim();
  const loadKey = useMemo(
    () =>
      JSON.stringify({
        accountId,
        accountEmail,
        direction,
        sortKey: tabOpts.sortKey,
        sortDir: tabOpts.sortDir,
        search: searchTrim,
        category: tabOpts.category,
      }),
    [
      accountId,
      accountEmail,
      direction,
      tabOpts.sortKey,
      tabOpts.sortDir,
      searchTrim,
      tabOpts.category,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!accountId || !accountEmail) {
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [list, cnt] = await Promise.all([
          getMailFilesAttachments(accountId, accountEmail, direction, {
            sortKey: tabOpts.sortKey,
            sortDir: tabOpts.sortDir,
            search: searchTrim || undefined,
            category: tabOpts.category,
            limit: PAGE_SIZE,
            offset: 0,
          }),
          countMailFilesAttachments(accountId, accountEmail, direction, {
            search: searchTrim || undefined,
            category: tabOpts.category,
          }),
        ]);
        if (cancelled) return;
        setRows(list);
        setTotal(cnt);
      } catch (err) {
        if (!cancelled) {
          console.error("[FilesPage] load failed:", err);
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadKey, accountId, accountEmail, direction, tabOpts.sortKey, tabOpts.sortDir, searchTrim, tabOpts.category]);

  const handleLoadMore = useCallback(async () => {
    if (!accountId || !accountEmail || loading || loadingMore || rows.length >= total) return;
    setLoadingMore(true);
    try {
      const more = await getMailFilesAttachments(accountId, accountEmail, direction, {
        sortKey: tabOpts.sortKey,
        sortDir: tabOpts.sortDir,
        search: searchTrim || undefined,
        category: tabOpts.category,
        limit: PAGE_SIZE,
        offset: rows.length,
      });
      setRows((prev) => [...prev, ...more]);
    } catch (err) {
      console.error("[FilesPage] load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [
    accountId,
    accountEmail,
    direction,
    loading,
    loadingMore,
    rows.length,
    total,
    tabOpts.sortKey,
    tabOpts.sortDir,
    searchTrim,
    tabOpts.category,
  ]);

  const handleDownload = useCallback(
    async (att: MailAttachmentFileRow) => {
      const partId = att.gmail_attachment_id ?? att.imap_part_id ?? null;
      if (!partId || !accountId) return;
      try {
        const filePath = await save({
          defaultPath: att.filename ?? "attachment",
          filters: [{ name: "Все файлы", extensions: ["*"] }],
        });
        if (!filePath) return;
        const provider = await getEmailProvider(accountId);
        const response = await provider.fetchAttachment(att.message_id, partId);
        const bytes = base64UrlToUint8Array(response.data);
        await writeFile(filePath, bytes);
      } catch (err) {
        console.error("[FilesPage] download failed:", err);
      }
    },
    [accountId],
  );

  const handleOpenInMail = useCallback((att: MailAttachmentFileRow) => {
    if (att.thread_id) {
      navigateToLabel("all", { threadId: att.thread_id });
    }
  }, []);

  const toggleSortDir = () => {
    setTabOpts((o) => ({
      ...o,
      sortDir: o.sortDir === "asc" ? "desc" : "asc",
    }));
  };

  const sortDirLabel =
    tabOpts.sortKey === "date"
      ? tabOpts.sortDir === "desc"
        ? "Новые сверху"
        : "Старые сверху"
      : tabOpts.sortKey === "filename"
        ? tabOpts.sortDir === "asc"
          ? "А → Я"
          : "Я → А"
        : tabOpts.sortDir === "desc"
          ? "Больше → меньше"
          : "Меньше → больше";

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden bg-bg-primary/80">
      <div className="shrink-0 border-b border-border-primary px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <FolderOpen size={20} className="text-text-secondary shrink-0" />
            <h1 className="text-base font-semibold text-text-primary">Файлы</h1>
            {!loading && total > 0 && (
              <span className="text-xs text-text-tertiary">({total})</span>
            )}
          </div>

          <div className="flex rounded-lg border border-border-primary p-0.5 bg-bg-secondary/80">
            <Link
              to="/files/$tab"
              params={{ tab: "incoming" }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                direction === "incoming"
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Входящие
            </Link>
            <Link
              to="/files/$tab"
              params={{ tab: "outgoing" }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                direction === "outgoing"
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Исходящие
            </Link>
          </div>

          <div className="flex-1 min-w-[120px]" />

          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
            <input
              type="search"
              value={tabOpts.search}
              onChange={(e) => setTabOpts((o) => ({ ...o, search: e.target.value }))}
              placeholder="Поиск по имени файла"
              className="w-52 rounded-md border border-border-primary bg-bg-secondary py-1.5 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <select
            value={tabOpts.category}
            onChange={(e) =>
              setTabOpts((o) => ({
                ...o,
                category: e.target.value as MailFilesTypeCategory,
              }))
            }
            className="rounded-md border border-border-primary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            title="Тип файла"
          >
            <option value="all">Все типы</option>
            <option value="documents">Документы</option>
            <option value="images">Изображения</option>
            <option value="archives">Архивы</option>
            <option value="spreadsheets">Таблицы</option>
            <option value="pdf">PDF</option>
            <option value="other">Другое</option>
          </select>

          <span className="text-xs text-text-tertiary whitespace-nowrap">Сортировка:</span>
          <select
            value={tabOpts.sortKey}
            onChange={(e) =>
              setTabOpts((o) => ({
                ...o,
                sortKey: e.target.value as MailFilesSortKey,
              }))
            }
            className="rounded-md border border-border-primary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="date">По дате</option>
            <option value="filename">По имени</option>
            <option value="size">По размеру</option>
          </select>
          <button
            type="button"
            onClick={toggleSortDir}
            title={sortDirLabel}
            className="flex items-center gap-1 rounded-md border border-border-primary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary hover:bg-sidebar-hover transition-colors"
          >
            {tabOpts.sortKey === "filename" ? (
              tabOpts.sortDir === "asc" ? (
                <ArrowDownAZ size={14} />
              ) : (
                <ArrowUpAZ size={14} />
              )
            ) : tabOpts.sortKey === "size" ? (
              tabOpts.sortDir === "desc" ? (
                <ArrowDownWideNarrow size={14} />
              ) : (
                <ArrowUpNarrowWide size={14} />
              )
            ) : tabOpts.sortDir === "desc" ? (
              <ArrowDownWideNarrow size={14} />
            ) : (
              <ArrowUpNarrowWide size={14} />
            )}
            <span className="max-w-[140px] truncate">{sortDirLabel}</span>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!accountId ? (
          <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
            Выберите учётную запись
          </div>
        ) : loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-text-tertiary">
            <Loader2 className="animate-spin" size={22} />
            <span>Загрузка…</span>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="Файлов пока нет"
            subtitle="Вложения из писем появятся здесь после синхронизации."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border-primary">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="bg-bg-secondary/90 text-text-tertiary sticky top-0 z-[1]">
                  <tr>
                    <th className="px-3 py-2 font-medium w-10" aria-hidden />
                    <th className="px-3 py-2 font-medium">Имя файла</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">Размер</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">Дата письма</th>
                    <th className="px-3 py-2 font-medium">
                      {direction === "incoming" ? "Отправитель" : "Получатель"}
                    </th>
                    <th className="px-3 py-2 font-medium">Тема</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">Тип</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">Направление</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">Состояние</th>
                    <th className="px-3 py-2 font-medium text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-primary text-text-primary">
                  {rows.map((att) => {
                    const partId = att.gmail_attachment_id ?? att.imap_part_id ?? null;
                    const hasLocal =
                      typeof att.local_path === "string" && att.local_path.length > 0;
                    const counterparty =
                      direction === "incoming"
                        ? att.from_name?.trim() || att.from_address || "—"
                        : firstAddressPreview(att.to_addresses);
                    const dirLabel =
                      direction === "incoming" ? "Входящее" : "Исходящее";
                    return (
                      <tr key={att.id} className="hover:bg-sidebar-hover/40">
                        <td className="px-3 py-2 text-base" title={att.mime_type ?? ""}>
                          {getFileIcon(att.mime_type, att.filename)}
                        </td>
                        <td className="px-3 py-2 max-w-[220px]">
                          <div className="truncate font-medium" title={att.filename ?? ""}>
                            {att.filename ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-text-secondary">
                          {formatFileSize(att.size ?? 0)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-text-secondary">
                          {formatMessageDate(att.date)}
                        </td>
                        <td className="px-3 py-2 max-w-[180px]">
                          <div className="truncate" title={counterparty}>
                            {counterparty}
                          </div>
                        </td>
                        <td className="px-3 py-2 max-w-[200px]">
                          <div className="truncate text-text-secondary" title={att.subject ?? ""}>
                            {att.subject ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-text-secondary">
                          {fileExtension(att.filename)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-text-secondary">
                          {dirLabel}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {hasLocal ? (
                            <span className="text-emerald-600/90 dark:text-emerald-400/90">На диске</span>
                          ) : (
                            <span className="text-text-tertiary">Не загружен</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1.5 flex-wrap">
                            {att.thread_id && (
                              <button
                                type="button"
                                onClick={() => handleOpenInMail(att)}
                                className="rounded border border-border-primary px-2 py-1 text-[0.6875rem] hover:bg-accent/10 hover:border-accent/40 transition-colors"
                              >
                                <span className="inline-flex items-center gap-1">
                                  <Mail size={12} />
                                  В письме
                                </span>
                              </button>
                            )}
                            {partId && (
                              <button
                                type="button"
                                onClick={() => void handleDownload(att)}
                                className="rounded border border-border-primary px-2 py-1 text-[0.6875rem] hover:bg-accent/10 hover:border-accent/40 transition-colors"
                              >
                                <span className="inline-flex items-center gap-1">
                                  <Download size={12} />
                                  Скачать
                                </span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {rows.length < total && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={handleLoadMore}
                  className="rounded-md border border-border-primary bg-bg-secondary px-4 py-2 text-xs text-text-primary hover:bg-sidebar-hover disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? "Загрузка…" : `Показать ещё (${rows.length} / ${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
