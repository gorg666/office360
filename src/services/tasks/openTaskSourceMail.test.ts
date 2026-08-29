import { describe, expect, it, vi } from "vitest";
import type { Task } from "./domain";
import { openTaskSourceMail } from "./openTaskSourceMail";

function mailTask(source: Task["source"]): Pick<Task, "source"> {
  return { source };
}

describe("openTaskSourceMail", () => {
  it("navigates using messageId → threadId", async () => {
    const navigateToLabel = vi.fn();
    const setActiveAccount = vi.fn();
    const result = await openTaskSourceMail(
      mailTask([
        {
          id: "s1",
          taskId: "t1",
          type: "mail",
          accountId: "acc-1",
          messageId: "msg-1",
          threadId: null,
          rfcMessageId: null,
          subjectSnapshot: "Hello",
          senderSnapshot: "a@b.c",
          createdAt: 1,
        },
      ]),
      {
        getAccounts: () => [{ id: "acc-1", isActive: false }],
        getMessageById: async () =>
          ({ thread_id: "thr-9" }) as Awaited<ReturnType<NonNullable<Parameters<typeof openTaskSourceMail>[1]["getMessageById"]>>>,
        setActiveAccount,
        navigateToLabel,
      },
    );
    expect(result).toEqual({ ok: true, threadId: "thr-9", accountId: "acc-1" });
    expect(setActiveAccount).toHaveBeenCalledWith("acc-1");
    expect(navigateToLabel).toHaveBeenCalledWith("all", { threadId: "thr-9" });
  });

  it("returns missing when mail is gone", async () => {
    const result = await openTaskSourceMail(
      mailTask([
        {
          id: "s1",
          taskId: "t1",
          type: "mail",
          accountId: "acc-1",
          messageId: "gone",
          threadId: null,
          rfcMessageId: null,
          subjectSnapshot: null,
          senderSnapshot: null,
          createdAt: 1,
        },
      ]),
      {
        getAccounts: () => [{ id: "acc-1", isActive: true }],
        getMessageById: async () => null,
        navigateToLabel: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("returns permission-denied when account is not available", async () => {
    const result = await openTaskSourceMail(
      mailTask([
        {
          id: "s1",
          taskId: "t1",
          type: "mail",
          accountId: "other",
          messageId: "m1",
          threadId: "t1",
          rfcMessageId: null,
          subjectSnapshot: null,
          senderSnapshot: null,
          createdAt: 1,
        },
      ]),
      {
        getAccounts: () => [{ id: "acc-1", isActive: true }],
        navigateToLabel: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: false, reason: "permission-denied" });
  });

  it("falls back to threadId when message lookup fails but thread known", async () => {
    const navigateToLabel = vi.fn();
    const result = await openTaskSourceMail(
      mailTask([
        {
          id: "s1",
          taskId: "t1",
          type: "mail",
          accountId: "acc-1",
          messageId: "gone",
          threadId: "thr-keep",
          rfcMessageId: null,
          subjectSnapshot: null,
          senderSnapshot: null,
          createdAt: 1,
        },
      ]),
      {
        getAccounts: () => [{ id: "acc-1", isActive: true }],
        getMessageById: async () => null,
        navigateToLabel,
      },
    );
    expect(result).toEqual({ ok: true, threadId: "thr-keep", accountId: "acc-1" });
    expect(navigateToLabel).toHaveBeenCalledWith("all", { threadId: "thr-keep" });
  });
});
