import { useCallback, useEffect, useState } from "react";
import { getOutboxSendCount } from "@/services/db/pendingOperations";
import { getUnreadInboxCount, getUnreadInboxCountsByAccount } from "@/services/db/threads";
import { useTaskStore } from "@/stores/taskStore";
import type { ServiceNavBadgeSource } from "./serviceNavRegistry";

export const MAIL_UNREAD_CHANGED_EVENT = "velo-mail-unread-changed";

export interface ServiceNavState {
  badgeCount?: number;
  attention?: boolean;
}

async function loadInboxUnread(activeAccountId: string | null): Promise<number> {
  if (!activeAccountId) {
    return getUnreadInboxCount();
  }
  const byAccount = await getUnreadInboxCountsByAccount([activeAccountId]);
  return byAccount[activeAccountId] ?? 0;
}

/**
 * Thin derived nav badges over existing stores/DB — Sidebar must not call service APIs.
 * Messenger unread: BLOCKED / NO SOURCE (widget does not expose counts).
 */
export function useServiceNavBadges(activeAccountId: string | null) {
  const taskIncompleteCount = useTaskStore((s) => s.incompleteCount);
  const [outboxSendCount, setOutboxSendCount] = useState(0);
  const [mailInboxUnread, setMailInboxUnread] = useState(0);

  const refreshOutbox = useCallback(async () => {
    if (!activeAccountId) {
      setOutboxSendCount(0);
      return;
    }
    setOutboxSendCount(await getOutboxSendCount(activeAccountId));
  }, [activeAccountId]);

  const refreshMailUnread = useCallback(async () => {
    try {
      setMailInboxUnread(await loadInboxUnread(activeAccountId));
    } catch {
      setMailInboxUnread(0);
    }
  }, [activeAccountId]);

  useEffect(() => {
    void refreshOutbox();
  }, [refreshOutbox]);

  useEffect(() => {
    void refreshMailUnread();
  }, [refreshMailUnread]);

  useEffect(() => {
    const onOutbox = () => void refreshOutbox();
    window.addEventListener("velo-outbox-changed", onOutbox);
    window.addEventListener("online", onOutbox);
    return () => {
      window.removeEventListener("velo-outbox-changed", onOutbox);
      window.removeEventListener("online", onOutbox);
    };
  }, [refreshOutbox]);

  useEffect(() => {
    const onMail = () => void refreshMailUnread();
    window.addEventListener(MAIL_UNREAD_CHANGED_EVENT, onMail);
    window.addEventListener("velo-mail-sync-complete", onMail);
    window.addEventListener("online", onMail);
    return () => {
      window.removeEventListener(MAIL_UNREAD_CHANGED_EVENT, onMail);
      window.removeEventListener("velo-mail-sync-complete", onMail);
      window.removeEventListener("online", onMail);
    };
  }, [refreshMailUnread]);

  const getBadgeCount = useCallback(
    (source: ServiceNavBadgeSource): number => {
      switch (source) {
        case "mailInboxUnread":
          return mailInboxUnread;
        case "outboxSend":
          return outboxSendCount;
        case "tasksIncomplete":
          return taskIncompleteCount;
        default:
          return 0;
      }
    },
    [mailInboxUnread, outboxSendCount, taskIncompleteCount],
  );

  const getNavState = useCallback(
    (source: ServiceNavBadgeSource): ServiceNavState => {
      const badgeCount = getBadgeCount(source);
      return badgeCount > 0 ? { badgeCount } : {};
    },
    [getBadgeCount],
  );

  return {
    mailInboxUnread,
    outboxSendCount,
    taskIncompleteCount,
    getBadgeCount,
    getNavState,
    refreshMailUnread,
    refreshOutbox,
  };
}
