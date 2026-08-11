import { useEffect, useState, useRef, useCallback } from "react";
import { useAccountStore, type Account } from "@/stores/accountStore";
import { ChevronDown, ChevronUp, Check, Plus, UserPlus, Calendar, Copy, Settings } from "lucide-react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { ContactAvatar } from "@/components/ui/ContactAvatar";
import { getUnreadInboxCountsByAccount } from "@/services/db/threads";
import { listAccountSyncHealth, syncHealthStatusLabel, syncProgressLabel, type AccountSyncHealth } from "@/services/syncHealth";
import { navigateToLabel } from "@/router/navigate";

interface AccountSwitcherProps {
  collapsed: boolean;
  onAddAccount: () => void;
  dropdownPlacement?: "down" | "up";
}

export function AccountSwitcher({
  collapsed,
  onAddAccount,
  dropdownPlacement = "down",
}: AccountSwitcherProps) {
  const { accounts, activeAccountId, setActiveAccount } = useAccountStore();
  const [open, setOpen] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [healthByAccount, setHealthByAccount] = useState<Record<string, AccountSyncHealth>>({});
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useClickOutside(dropdownRef, () => setOpen(false));

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const activeUnreadCount = activeAccountId ? unreadCounts[activeAccountId] ?? 0 : 0;
  const ChevronIcon = dropdownPlacement === "up" ? ChevronUp : ChevronDown;
  const dropdownPositionClass = dropdownPlacement === "up"
    ? collapsed
      ? "left-full ml-1 bottom-0 w-64"
      : "left-2 right-2 bottom-full mb-1"
    : collapsed
      ? "left-full ml-1 top-0 w-64"
      : "left-2 right-2 mt-1";

  const handleSwitch = useCallback(
    (id: string) => {
      setActiveAccount(id);
      setOpen(false);
    },
    [setActiveAccount],
  );

  const handleAdd = useCallback(() => {
    onAddAccount();
    setOpen(false);
  }, [onAddAccount]);

  const handleOpenSettings = useCallback(() => {
    navigateToLabel("settings");
    setOpen(false);
  }, []);

  const handleCopyEmail = useCallback(async () => {
    if (!activeAccount?.email) return;
    try {
      await navigator.clipboard.writeText(activeAccount.email);
      setCopyFeedback("Email скопирован");
      window.setTimeout(() => setCopyFeedback(null), 1500);
    } catch {
      setCopyFeedback("Не удалось скопировать email");
      window.setTimeout(() => setCopyFeedback(null), 1500);
    }
  }, [activeAccount?.email]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const accountIds = accounts.map((account) => account.id);
    let cancelled = false;

    async function refreshAccountState() {
      try {
        const [counts, health] = await Promise.all([
          getUnreadInboxCountsByAccount(accountIds),
          listAccountSyncHealth(accountIds),
        ]);
        if (!cancelled) {
          setUnreadCounts((current) => {
            const currentKeys = Object.keys(current);
            const nextKeys = Object.keys(counts);
            const unchanged = currentKeys.length === nextKeys.length
              && nextKeys.every((key) => current[key] === counts[key]);
            return unchanged ? current : counts;
          });
          setHealthByAccount(Object.fromEntries(health.map((item) => [item.accountId, item])));
        }
      } catch (err) {
        console.error("Failed to load account state:", err);
      }
    }

    void refreshAccountState();
    window.addEventListener("velo-sync-done", refreshAccountState);
    window.addEventListener("velo-queue-changed", refreshAccountState);
    window.addEventListener("velo-sync-health-changed", refreshAccountState);
    return () => {
      cancelled = true;
      window.removeEventListener("velo-sync-done", refreshAccountState);
      window.removeEventListener("velo-queue-changed", refreshAccountState);
      window.removeEventListener("velo-sync-health-changed", refreshAccountState);
    };
  }, [accounts]);

  // No accounts — prompt to add
  if (accounts.length === 0) {
    return (
      <div className="p-3">
        <button
          onClick={onAddAccount}
          className={`flex items-center w-full rounded-lg p-2 text-sm text-sidebar-text/70 hover:bg-sidebar-hover hover:text-sidebar-text transition-colors ${
            collapsed ? "justify-center" : "gap-3"
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
            <UserPlus size={16} className="text-accent" />
          </div>
          {!collapsed && <span className="font-medium">Add Account</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="relative p-2" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center w-full rounded-lg p-1.5 hover:bg-sidebar-hover transition-colors ${
          collapsed ? "justify-center" : "gap-2.5"
        } ${open ? "bg-sidebar-hover" : ""}`}
      >
        <ActiveAvatar account={activeAccount} />
        <UnreadBadge count={activeUnreadCount} placement="trigger" />
        {!collapsed && activeAccount && (
          <>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium text-sidebar-text truncate leading-tight">
                {activeAccount.displayName || activeAccount.email.split("@")[0]}
              </div>
              <div className="text-xs text-sidebar-text/50 truncate leading-tight">
                {activeAccount.email}
              </div>
            </div>
            <ChevronIcon
              size={14}
              className={`shrink-0 text-sidebar-text/40 transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={`absolute z-50 py-1 rounded-lg border border-border-primary bg-bg-primary shadow-lg glass-panel ${
            dropdownPositionClass
          }`}
        >
          {activeAccount ? (
            <div className="px-3 pt-2 pb-2 border-b border-border-primary">
              <div className="flex items-start gap-2.5">
                <ActiveAvatar account={activeAccount} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary leading-tight">
                    {activeAccount.displayName || activeAccount.email.split("@")[0]}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary leading-tight select-text break-all">
                    {activeAccount.email}
                  </div>
                  <div className="mt-1 text-[0.625rem] text-text-tertiary">
                    {formatProviderLabel(activeAccount.provider)} · Подключен
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={handleCopyEmail}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-primary px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                >
                  <Copy size={12} />
                  Скопировать email
                </button>
                <button
                  onClick={handleOpenSettings}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-primary px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                >
                  <Settings size={12} />
                  Настройки аккаунта
                </button>
              </div>
              {copyFeedback ? (
                <div className="mt-1.5 text-[0.6875rem] text-success">{copyFeedback}</div>
              ) : null}
            </div>
          ) : null}
          {accounts.length > 1 && (
            <div className="px-3 py-1.5 text-[0.625rem] font-medium text-text-tertiary uppercase tracking-wider">
              Accounts
            </div>
          )}
          {accounts.map((account) => {
            const isActive = account.id === activeAccountId;
            const unreadCount = unreadCounts[account.id] ?? 0;
            const health = healthByAccount[account.id];
            const healthStatus = health?.status;
            return (
              <button
                key={account.id}
                onClick={() => handleSwitch(account.id)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-accent/8 text-accent"
                    : "text-text-primary hover:bg-bg-hover"
                }`}
              >
                <AccountAvatarSmall
                  account={account}
                  isActive={isActive}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate leading-tight flex items-center gap-1.5">
                    {account.displayName || account.email.split("@")[0]}
                    {account.provider === "caldav" && (
                      <Calendar size={12} className="shrink-0 text-text-tertiary" />
                    )}
                  </div>
                  <div className="text-xs text-text-secondary truncate leading-tight">
                    {account.email}
                  </div>
                  {healthStatus && healthStatus !== "healthy" && (
                    <div className="mt-0.5 text-[0.625rem] text-text-tertiary">
                      {healthStatus === "syncing"
                        ? syncProgressLabel(health?.progress) ?? syncHealthStatusLabel(healthStatus)
                        : syncHealthStatusLabel(healthStatus)}
                    </div>
                  )}
                </div>
                <UnreadBadge count={unreadCount} placement="inline" />
                {isActive && (
                  <Check size={14} className="shrink-0 text-accent" />
                )}
              </button>
            );
          })}
          <div className="border-t border-border-primary my-1" />
          <button
            onClick={handleAdd}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0">
              <Plus size={14} />
            </div>
            <span>Add account</span>
          </button>
        </div>
      )}
    </div>
  );
}

function formatProviderLabel(provider: Account["provider"]): string {
  if (provider === "gmail_api") return "Gmail";
  if (provider === "yandex_oauth") return "Yandex";
  if (provider === "imap_smtp") return "IMAP";
  if (provider === "caldav") return "CalDAV";
  return provider ?? "Account";
}

/** The main avatar shown in the trigger — slightly larger */
function ActiveAvatar({ account }: { account: Account | undefined }) {
  if (!account) return null;

  return (
    <ContactAvatar
      email={account.email}
      name={account.displayName}
      avatarUrl={account.avatarUrl}
      className="w-8 h-8 rounded-full shrink-0"
      textClassName="text-sm"
      fallbackClassName="bg-accent/15 text-accent"
      showDomainFallback={false}
      lookupExternalAvatar
    />
  );
}

/** Smaller avatar used inside the dropdown list */
function AccountAvatarSmall({
  account,
  isActive,
}: {
  account: Account;
  isActive: boolean;
}) {
  return (
    <ContactAvatar
      email={account.email}
      name={account.displayName}
      avatarUrl={account.avatarUrl}
      className="w-7 h-7 rounded-full shrink-0"
      textClassName="text-xs"
      fallbackClassName={
        isActive
          ? "bg-accent text-white"
          : "bg-accent/12 text-accent"
      }
      showDomainFallback={false}
      lookupExternalAvatar
    />
  );
}

function UnreadBadge({
  count,
  compact = false,
  placement = "avatar",
}: {
  count: number;
  compact?: boolean;
  placement?: "avatar" | "trigger" | "inline";
}) {
  if (count <= 0) return null;

  const label = count > 99 ? "99+" : String(count);
  if (placement === "inline") {
    return (
      <span
        className="shrink-0 rounded-full bg-danger px-1.5 text-[0.625rem] font-semibold leading-4 text-white"
        aria-label={`${count} unread emails`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`absolute flex min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-semibold leading-4 text-white ring-2 ring-sidebar-bg ${
        placement === "trigger" ? "right-0 top-0" : "-right-1 -top-1"
      } ${
        compact ? "min-w-[0.875rem] leading-[0.875rem] text-[0.5625rem]" : ""
      }`}
      aria-label={`${count} unread emails`}
    >
      {label}
    </span>
  );
}
