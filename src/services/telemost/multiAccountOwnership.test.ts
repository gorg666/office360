import { beforeEach, describe, expect, it } from "vitest";
import {
  assertOpenJoinOwnership,
  canOpenMeetingUnderAccount,
  classifyMeetingOwnership,
  clearTelemostAccountScopedData,
  parseTelemostOwnedEvent,
  requireTelemostServiceAccount,
  shouldAcceptOwnedTelemostEvent,
  stampCreatedMeetingOwner,
  TELEMOST_ACCOUNT_STORAGE_PREFIXES,
} from "./multiAccountOwnership";
import {
  decideAuthenticatedIdentity,
  invalidateVerifiedBrowserAuth,
  parseTelemostAuthBeacon,
  rememberVerifiedBrowserAuth,
  shouldSkipAuthCheck,
  writePendingJoin,
} from "./directJoinAuth";

describe("commercial multi-account ownership", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    invalidateVerifiedBrowserAuth();
  });

  it("does not let A's cached AUTHENTICATED authenticate B", () => {
    rememberVerifiedBrowserAuth("account-a", "uid-a", "a@example.test", 1_000);
    expect(shouldSkipAuthCheck("account-a", 1_000)).toBe(true);
    expect(shouldSkipAuthCheck("account-b", 1_000)).toBe(false);
  });

  it("ignores a stale A AUTHENTICATED event after switching to B", () => {
    const stale = parseTelemostOwnedEvent({ owner_account_id: "account-a", epoch: 1, payload: "auth=AUTHENTICATED;uid=1;login=a@example.test;surface=check" });
    expect(shouldAcceptOwnedTelemostEvent(stale, "account-b", 2)).toBe(false);
    expect(shouldAcceptOwnedTelemostEvent(stale, "account-a", 1)).toBe(true);
    expect(shouldAcceptOwnedTelemostEvent(parseTelemostOwnedEvent("auth=AUTHENTICATED"), "account-b", 2)).toBe(false);
  });

  it("rejects OPEN_JOIN when pending join belongs to another account", () => {
    writePendingJoin("account-a", {
      id: "meet-a",
      title: "A",
      joinUrl: "https://telemost.yandex.ru/j/111",
      ownerAccountId: "account-a",
      epoch: 1,
    });
    expect(assertOpenJoinOwnership({
      pending: {
        id: "meet-a",
        title: "A",
        joinUrl: "https://telemost.yandex.ru/j/111",
        ownerAccountId: "account-a",
        epoch: 1,
      },
      serviceAccountId: "account-b",
      wkOwnerAccountId: "account-b",
      currentEpoch: 2,
    })).toBe("rejected");
    expect(assertOpenJoinOwnership({
      pending: {
        id: "meet-a",
        title: "A",
        joinUrl: "https://telemost.yandex.ru/j/111",
        ownerAccountId: "account-a",
        epoch: 1,
      },
      serviceAccountId: "account-a",
      wkOwnerAccountId: "account-a",
      currentEpoch: 1,
      authResultOwnerAccountId: "account-a",
    })).toBe("ok");
  });

  it("fails closed when OAuth account X does not match Passport identity Y", () => {
    expect(decideAuthenticatedIdentity({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=y-uid;login=y@yandex.ru;surface=check"),
      pendingJoinUrl: "https://telemost.yandex.ru/j/1",
      alreadyResumedJoinUrl: null,
      expectedEmail: "x@yandex.ru",
      expectedUid: "x-uid",
    })).toBe("mismatch");
  });

  it("fails closed when beacon uid exists but login is empty and no expected uid", () => {
    expect(decideAuthenticatedIdentity({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=42;login=;surface=check"),
      pendingJoinUrl: "https://telemost.yandex.ru/j/1",
      alreadyResumedJoinUrl: null,
    })).toBe("auth_required");
  });

  it("clears only the deleted account Telemost namespaces", () => {
    for (const prefix of TELEMOST_ACCOUNT_STORAGE_PREFIXES) {
      localStorage.setItem(`${prefix}:account-a`, "a");
      localStorage.setItem(`${prefix}:account-b`, "b");
    }
    sessionStorage.setItem("office360_telemost_pending_join:account-a", "{\"id\":\"1\"}");
    sessionStorage.setItem("office360_telemost_pending_join:account-b", "{\"id\":\"2\"}");
    rememberVerifiedBrowserAuth("account-a", "uid-a", "a@example.test", 1);
    clearTelemostAccountScopedData("account-a");
    for (const prefix of TELEMOST_ACCOUNT_STORAGE_PREFIXES) {
      expect(localStorage.getItem(`${prefix}:account-a`)).toBeNull();
      expect(localStorage.getItem(`${prefix}:account-b`)).toBe("b");
    }
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-a")).toBeNull();
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-b")).toBe("{\"id\":\"2\"}");
  });

  it("does not silently open an Office360-created meeting under another owner", () => {
    const ownedA = stampCreatedMeetingOwner({
      id: "1",
      title: "A meeting",
      joinUrl: "https://telemost.yandex.ru/j/1",
      source: "created" as const,
    }, "account-a");
    expect(classifyMeetingOwnership(ownedA)).toBe("owned");
    expect(canOpenMeetingUnderAccount(ownedA, "account-a")).toBe(true);
    expect(canOpenMeetingUnderAccount(ownedA, "account-b")).toBe(false);
    expect(canOpenMeetingUnderAccount({
      source: "invited",
      joinUrl: "https://telemost.yandex.ru/j/9",
    }, "account-b")).toBe(true);
  });

  it("accepts A WEB_CREATED events and ignores stale A events under B", () => {
    const join = "https://telemost.yandex.ru/j/98543805636845?browser-auto-create=1";
    const createdA = parseTelemostOwnedEvent({ owner_account_id: "account-a", epoch: 1, payload: join });
    expect(shouldAcceptOwnedTelemostEvent(createdA, "account-a", 1)).toBe(true);
    expect(shouldAcceptOwnedTelemostEvent(createdA, "account-b", 1)).toBe(false);
    expect(shouldAcceptOwnedTelemostEvent(createdA, "account-a", 2)).toBe(false);
    const stored = stampCreatedMeetingOwner({
      id: "98543805636845",
      title: "Видеовстреча",
      joinUrl: join,
      source: "WEB_CREATED" as const,
    }, "account-a");
    expect(stored.ownerAccountId).toBe("account-a");
    expect(canOpenMeetingUnderAccount(stored, "account-a")).toBe(true);
    expect(canOpenMeetingUnderAccount(stored, "account-b")).toBe(false);
  });

  it("works for a clean-install first arbitrary account without historical state", () => {
    expect(requireTelemostServiceAccount(undefined)).toBeNull();
    expect(requireTelemostServiceAccount("account-first")).toBe("account-first");
    expect(shouldAcceptOwnedTelemostEvent(
      parseTelemostOwnedEvent({ owner_account_id: "account-first", epoch: 1, payload: "PREJOIN" }),
      "account-first",
      1,
    )).toBe(true);
    expect(localStorage.length).toBe(0);
  });
});
