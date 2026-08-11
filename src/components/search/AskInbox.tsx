import { useState, useRef, useCallback, useEffect } from "react";
import { Search, X, Send, ExternalLink, Sparkles } from "lucide-react";
import { askMyInbox, type AskInboxResult } from "@/services/ai/askInbox";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { navigateToLabel } from "@/router/navigate";
import { getThreadLabelIds } from "@/services/db/threads";

const SYSTEM_LABEL_ROUTES: Array<{ gmailLabel: string; routeLabel: string }> = [
  { gmailLabel: "DRAFT", routeLabel: "drafts" },
  { gmailLabel: "SENT", routeLabel: "sent" },
  { gmailLabel: "INBOX", routeLabel: "inbox" },
  { gmailLabel: "SNOOZED", routeLabel: "snoozed" },
  { gmailLabel: "SPAM", routeLabel: "spam" },
  { gmailLabel: "TRASH", routeLabel: "trash" },
  { gmailLabel: "STARRED", routeLabel: "starred" },
];

function normalizeEmail(value: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function getRouteLabelForSource(labels: string[], isOutgoingSource: boolean): string {
  if (isOutgoingSource && labels.includes("SENT")) return "sent";

  const route = SYSTEM_LABEL_ROUTES.find(({ gmailLabel }) => labels.includes(gmailLabel));
  return route?.routeLabel ?? "all";
}

export function AskInbox() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskInboxResult | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const sourceCount = result?.sourceMessages.length ?? 0;
  const hasDropdownContent = loading || !!result || question.trim().length === 0 || !activeAccountId;

  const handleAsk = useCallback(async () => {
    if (!question.trim() || !activeAccountId || loading) return;
    setLoading(true);
    setResult(null);
    setDropdownOpen(true);
    try {
      const res = await askMyInbox(question.trim(), activeAccountId);
      setResult(res);
    } catch (err) {
      console.error("Ask inbox failed:", err);
      setResult({
        answer: "Что-то пошло не так. Проверьте настройки ИИ и попробуйте ещё раз.",
        sourceMessages: [],
      });
    } finally {
      setLoading(false);
    }
  }, [question, activeAccountId, loading]);

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAsk();
      } else if (e.key === "Escape") {
        closeDropdown();
        inputRef.current?.blur();
      }
    },
    [closeDropdown, handleAsk],
  );

  const handleNavigateToThread = useCallback(async (msg: AskInboxResult["sourceMessages"][number]) => {
    const account = accounts.find((item) => item.id === msg.account_id);
    const isOutgoingSource = normalizeEmail(msg.from_address) === normalizeEmail(account?.email ?? null);

    try {
      const labels = await getThreadLabelIds(msg.account_id, msg.thread_id);
      const routeLabel = getRouteLabelForSource(labels, isOutgoingSource);
      useThreadStore.getState().selectThread(msg.thread_id);
      navigateToLabel(routeLabel, {
        threadId: msg.thread_id,
        category: routeLabel === "inbox" ? "All" : undefined,
      });
    } catch (err) {
      console.error("Failed to navigate to source thread:", err);
      useThreadStore.getState().selectThread(msg.thread_id);
      navigateToLabel("all", { threadId: msg.thread_id });
    }

    closeDropdown();
  }, [accounts, closeDropdown]);

  const handleClear = useCallback(() => {
    setQuestion("");
    setResult(null);
    setDropdownOpen(true);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleToggle = () => {
      setDropdownOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener("velo-toggle-ask-inbox", handleToggle);
    return () => window.removeEventListener("velo-toggle-ask-inbox", handleToggle);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeDropdown]);

  return (
    <div ref={containerRef} className="relative w-full max-w-[520px]">
      <div className="flex h-6 items-center gap-2 rounded-md border border-border-primary bg-bg-primary/85 px-2.5 shadow-sm backdrop-blur">
        <Search size={13} className="shrink-0 text-text-tertiary" />
        <input
          ref={inputRef}
          type="text"
          value={question}
          onFocus={() => setDropdownOpen(true)}
          onChange={(e) => {
            setQuestion(e.target.value);
            setDropdownOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Умный поиск по почте"
          className="min-w-0 flex-1 bg-transparent text-center text-xs text-text-primary outline-none placeholder:text-text-tertiary"
        />
        {question ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Очистить вопрос"
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <X size={14} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleAsk}
          disabled={!question.trim() || !activeAccountId || loading}
          aria-label="Спросить по почте"
          className="rounded-md p-1.5 text-accent transition-colors hover:bg-accent-light hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={15} />
        </button>
      </div>

      {dropdownOpen && hasDropdownContent ? (
        <div className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-[72vh] overflow-hidden rounded-xl border border-border-primary bg-bg-primary shadow-2xl glass-modal">
          <div className="max-h-[72vh] overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-text-tertiary">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                <span className="text-sm">Ищу по вашей почте...</span>
              </div>
            )}

            {result ? (
              <div className="divide-y divide-border-secondary">
                {sourceCount > 0 ? (
                  <section className="py-2">
                    <div className="px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-wider text-text-tertiary">
                      Источники ({sourceCount})
                    </div>
                    <div className="pb-1">
                      {result.sourceMessages.map((msg) => (
                        <button
                          key={msg.message_id}
                          type="button"
                          onClick={() => handleNavigateToThread(msg)}
                          className="group w-full px-4 py-2.5 text-left transition-colors hover:bg-bg-hover"
                        >
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium text-text-primary">
                                  {msg.subject ?? "(no subject)"}
                                </span>
                                <ExternalLink
                                  size={12}
                                  className="shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                                />
                              </div>
                              <div className="mt-0.5 truncate text-xs text-text-secondary">
                                {msg.snippet ?? "Нет предпросмотра"}
                              </div>
                              <div className="mt-1 truncate text-[0.6875rem] text-text-tertiary">
                                {msg.from_name ?? msg.from_address ?? "Неизвестный отправитель"}
                              </div>
                            </div>
                            <span className="shrink-0 pt-0.5 text-[0.6875rem] text-text-tertiary">
                              {new Date(msg.date).toLocaleDateString("ru-RU")}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-text-tertiary">
                    Подходящие письма не найдены.
                  </div>
                )}

                <section className="bg-bg-secondary/60 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-wider text-text-tertiary">
                    <Sparkles size={12} className="text-accent" />
                    Ответ
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                    {result.answer}
                  </div>
                </section>
              </div>
            ) : null}

            {!loading && !result ? (
              <div className="px-4 py-4 text-center">
                <div className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent-light text-accent">
                  <Sparkles size={14} />
                </div>
                <div className="text-sm font-medium text-text-primary">Спросите что угодно о вашей почте</div>
                <div className="mx-auto mt-1 max-w-sm text-xs leading-4 text-text-tertiary">
                  Найду переписки, договорённости, вложения, дедлайны и контекст в почтовом ящике.
                </div>
                {!activeAccountId ? (
                  <div className="mt-2 text-xs text-danger">Выберите аккаунт, чтобы задавать вопросы.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
