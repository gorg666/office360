import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { PeoplePicker } from "@/components/people/PeoplePicker";
import { calendarAclService } from "@/services/calendar/calendarAclService";
import { CalendarAclError, type CalendarAclCapabilities, type CalendarShareEntry, type CalendarShareRole } from "@/services/calendar/domain";
import type { DbCalendar } from "@/services/db/calendars";
import type { PersonIdentity } from "@/services/people";

interface CalendarAclDialogProps {
  accountId: string;
  calendar: DbCalendar;
  onClose: () => void;
  onPermissionsRefreshed?: () => void | Promise<void>;
}

const ASSIGNABLE_ROLES: CalendarShareRole[] = ["writer", "reader", "free-busy-only"];

export function CalendarAclDialog({ accountId, calendar, onClose, onPermissionsRefreshed }: CalendarAclDialogProps) {
  const [capabilities, setCapabilities] = useState<CalendarAclCapabilities | null>(null);
  const [entries, setEntries] = useState<CalendarShareEntry[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<PersonIdentity[]>([]);
  const [newRole, setNewRole] = useState<CalendarShareRole>("reader");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const generation = useRef(0);
  const target = { accountId, calendarId: calendar.id };

  const load = useCallback(async () => {
    const current = ++generation.current;
    setStatus("loading");
    setError(null);
    try {
      const nextCapabilities = await calendarAclService.capabilities(target);
      if (generation.current !== current) return;
      setCapabilities(nextCapabilities);
      const nextEntries = nextCapabilities.read === "supported"
        ? await calendarAclService.list(target)
        : [];
      if (generation.current !== current) return;
      setEntries(nextEntries);
      setStatus("ready");
    } catch (cause) {
      if (generation.current !== current) return;
      setStatus("error");
      setError(aclErrorMessage(cause));
    }
  }, [accountId, calendar.id]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const afterMutation = async () => {
    await onPermissionsRefreshed?.();
    await load();
  };

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    const person = selectedPeople[0];
    if (!person) return;
    setBusyKey("grant");
    setError(null);
    try {
      await calendarAclService.grant(target, person.email, newRole);
      setSelectedPeople([]);
      await afterMutation();
    } catch (cause) {
      setError(aclErrorMessage(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const updateRole = async (entry: CalendarShareEntry, role: CalendarShareRole) => {
    setBusyKey(entry.id);
    setError(null);
    try {
      await calendarAclService.updateRole(target, entry.id, role);
      await afterMutation();
    } catch (cause) {
      setError(aclErrorMessage(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const revoke = async (entry: CalendarShareEntry) => {
    setBusyKey(entry.id);
    setError(null);
    try {
      await calendarAclService.revoke(target, entry.id);
      await afterMutation();
    } catch (cause) {
      setError(aclErrorMessage(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const canWrite = capabilities?.write === "supported";
  return (
    <Modal isOpen onClose={onClose} title={`Доступ: ${calendar.display_name ?? "Календарь"}`} width="w-[34rem]">
      <div className="max-h-[70vh] overflow-y-auto p-4">
        {status === "loading" && (
          <div role="status" className="flex min-h-32 items-center justify-center gap-2 text-sm text-text-tertiary">
            <Loader2 size={16} className="animate-spin" /> Загрузка доступа…
          </div>
        )}

        {status === "error" && <AclNotice tone="error">{error ?? "Не удалось загрузить доступ."}</AclNotice>}

        {status === "ready" && capabilities?.read !== "supported" && (
          <AclNotice tone={capabilities?.read === "permission-denied" ? "error" : "neutral"}>
            {supportMessage(capabilities)}
          </AclNotice>
        )}

        {status === "ready" && capabilities?.read === "supported" && (
          <>
            <div className="space-y-1" aria-label="Участники календаря">
              {entries.length === 0 && <AclNotice tone="neutral">Участники не найдены.</AclNotice>}
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-bg-hover">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-text-primary">{entry.displayName || entry.participant?.displayName || entry.principalValue || "Системный доступ"}</div>
                    <div className="text-[11px] text-text-tertiary">
                      {entry.isCurrentUser ? "Вы · " : ""}{principalTypeLabel(entry.principalType)}
                      {entry.isOwner ? " · владелец" : ""}
                    </div>
                  </div>
                  <select
                    aria-label={`Роль ${entry.principalValue ?? entry.id}`}
                    value={entry.role}
                    disabled={!canWrite || entry.isProtected || busyKey === entry.id}
                    onChange={(event) => void updateRole(entry, event.target.value as CalendarShareRole)}
                    className="focus-ring rounded-control border border-outline bg-surface-solid px-2 py-1 text-control text-ink-primary disabled:opacity-60"
                  >
                    {entry.role === "owner" && <option value="owner">Владелец</option>}
                    {ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                  </select>
                  {canWrite && !entry.isProtected && (
                    <Button
                      iconOnly
                      size="xs"
                      variant="ghost"
                      aria-label={`Удалить доступ ${entry.principalValue ?? entry.id}`}
                      disabled={busyKey === entry.id}
                      onClick={() => void revoke(entry)}
                      icon={busyKey === entry.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    />
                  )}
                </div>
              ))}
            </div>

            {canWrite ? (
              <form onSubmit={(event) => void grant(event)} className="mt-4 border-t border-separator pt-4">
                <label className="mb-1 block text-xs font-medium text-text-secondary">Добавить человека</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <PeoplePicker
                    accountId={accountId}
                    label="Добавить человека"
                    selected={selectedPeople}
                    onChange={setSelectedPeople}
                    mode="single"
                    placeholder="Имя или email"
                    excludedEmails={entries.flatMap((entry) => entry.principalValue ? [entry.principalValue] : [])}
                    className="min-w-0 flex-1"
                  />
                  <select
                    aria-label="Новая роль"
                    value={newRole}
                    onChange={(event) => setNewRole(event.target.value as CalendarShareRole)}
                    className="focus-ring rounded-control border border-outline bg-surface-solid px-2 py-1 text-control text-ink-primary"
                  >
                    {ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                  </select>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={selectedPeople.length === 0 || busyKey !== null}
                    icon={busyKey === "grant" ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  >Добавить</Button>
                </div>
              </form>
            ) : (
              <AclNotice tone="neutral">Изменение доступа недоступно для этого календаря.</AclNotice>
            )}
          </>
        )}

        {error && status !== "error" && <div className="mt-3"><AclNotice tone="error">{error}</AclNotice></div>}
      </div>
    </Modal>
  );
}

function AclNotice({ children, tone }: { children: React.ReactNode; tone: "neutral" | "error" }) {
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-card px-3 py-3 text-meta ${tone === "error" ? "bg-danger-surface text-danger-text" : "bg-surface-sunken text-ink-tertiary"}`}>{children}</div>;
}

function roleLabel(role: CalendarShareRole): string {
  if (role === "owner") return "Владелец";
  if (role === "writer") return "Редактор";
  if (role === "reader") return "Читатель";
  return "Только занятость";
}

function supportMessage(capabilities: CalendarAclCapabilities | null): string {
  if (capabilities?.read === "permission-denied") return "Провайдер запретил просмотр настроек доступа.";
  if (capabilities?.read === "reauthorization-required") return "Переподключите аккаунт, чтобы разрешить управление доступом.";
  if (capabilities?.reason === "write-acl-contract-incomplete") return "Сервер не подтвердил полный стандартный контракт доступа DAV.";
  return "Управление доступом не поддерживается этим календарём.";
}

function principalTypeLabel(type: CalendarShareEntry["principalType"]): string {
  if (type === "user") return "Пользователь";
  if (type === "group") return "Группа";
  if (type === "domain") return "Домен";
  if (type === "public") return "Публичный";
  return "Системный";
}

function aclErrorMessage(cause: unknown): string {
  if (cause instanceof CalendarAclError) {
    switch (cause.code) {
      case "offline":
        return "Изменение доступа недоступно без сети. Ничего не было сохранено или поставлено в очередь.";
      case "unsupported":
        return "Управление доступом не поддерживается этим календарём.";
      case "permission-denied":
        return "Недостаточно прав, чтобы менять доступ к этому календарю.";
      case "reauthorization-required":
        return "Переподключите аккаунт, чтобы разрешить управление доступом.";
      case "duplicate-principal":
        return "У этого человека уже есть доступ к календарю.";
      case "invalid-principal":
        return "Введите корректный адрес электронной почты.";
      case "entry-not-found":
        return "Запись доступа больше недоступна.";
      case "owner-protected":
        return "Доступ владельца нельзя изменить здесь.";
      case "current-user-protected":
        return "Свой доступ нельзя изменить здесь.";
      case "refresh-failed":
        return "Не удалось обновить список доступа.";
      case "provider-error":
        return "Провайдер не смог изменить доступ. Обновите данные и попробуйте снова.";
      default:
        return "Не удалось изменить доступ. Обновите данные и попробуйте снова.";
    }
  }
  return "Не удалось изменить доступ. Обновите данные и попробуйте снова.";
}
