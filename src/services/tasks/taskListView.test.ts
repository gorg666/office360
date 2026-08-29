import { describe, expect, it } from "vitest";
import type { Task, TaskPrincipalRef } from "./domain";
import {
  emptyStateCopyRu,
  filterTasksBySection,
  filterTasksByText,
  isOverdue,
  priorityDisplayLabel,
  principalMatchesUser,
  sortTasksForList,
  statusDisplayLabel,
} from "./taskListView";

function principal(email: string, providerUid?: string): TaskPrincipalRef {
  return { email, displayName: email.split("@")[0], providerUid };
}

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  const now = 1_700_000_000;
  return {
    provider: "yandex-tracker",
    providerTaskId: partial.id,
    externalKey: null,
    organizationId: "org-1",
    description: null,
    status: "open",
    providerStatus: null,
    priority: "normal",
    providerPriority: null,
    assignee: null,
    createdBy: null,
    followers: [],
    dueAt: null,
    createdAt: now,
    updatedAt: now,
    providerUpdatedAt: now,
    syncState: "fresh",
    source: [],
    ...partial,
  };
}

const me = { email: "me@example.com", providerUid: "uid-me" };

describe("taskListView sections", () => {
  const rows = [
    task({
      id: "1",
      title: "Mine open",
      assignee: principal("me@example.com", "uid-me"),
      dueAt: 1_700_100_000,
      priority: "high",
    }),
    task({
      id: "2",
      title: "Created by me",
      createdBy: principal("ME@example.com"),
      assignee: principal("other@example.com"),
      dueAt: 1_700_200_000,
    }),
    task({
      id: "3",
      title: "Done mine",
      status: "done",
      assignee: principal("me@example.com"),
    }),
    task({
      id: "4",
      title: "Other org",
      organizationId: "org-2",
      assignee: principal("me@example.com"),
    }),
    task({
      id: "5",
      title: "Cancelled created",
      status: "cancelled",
      createdBy: principal("me@example.com", "uid-me"),
    }),
  ];

  it("filters my / created / completed with org scope", () => {
    expect(filterTasksBySection(rows, "my", me, "org-1").map((t) => t.id)).toEqual(["1"]);
    expect(filterTasksBySection(rows, "created-by-me", me, "org-1").map((t) => t.id)).toEqual(["2"]);
    expect(filterTasksBySection(rows, "completed", me, "org-1").map((t) => t.id).sort()).toEqual([
      "3",
      "5",
    ]);
  });

  it("matches current user by providerUid or normalized email", () => {
    expect(principalMatchesUser(principal("x@y.com", "uid-me"), me)).toBe(true);
    expect(principalMatchesUser(principal("ME@example.com"), me)).toBe(true);
    expect(principalMatchesUser(principal("other@example.com"), me)).toBe(false);
  });

  it("empty state copy", () => {
    expect(emptyStateCopyRu("my")).toContain("нет задач");
    expect(emptyStateCopyRu("created-by-me")).toContain("никому");
    expect(emptyStateCopyRu("completed")).toContain("завершённых");
  });
});

describe("taskListView sort and overdue", () => {
  const now = 1_700_000_000;

  it("marks overdue only for active dated tasks", () => {
    expect(isOverdue(task({ id: "a", title: "t", dueAt: now - 10 }), now)).toBe(true);
    expect(isOverdue(task({ id: "b", title: "t", status: "done", dueAt: now - 10 }), now)).toBe(false);
    expect(isOverdue(task({ id: "c", title: "t", dueAt: null }), now)).toBe(false);
  });

  it("sorts overdue, then nearest due, then priority, then updatedAt; undated lower", () => {
    const sorted = sortTasksForList(
      [
        task({ id: "undated", title: "u", priority: "critical", updatedAt: now + 50 }),
        task({ id: "later", title: "l", dueAt: now + 500, priority: "low", updatedAt: now }),
        task({ id: "soon", title: "s", dueAt: now + 100, priority: "low", updatedAt: now }),
        task({ id: "over", title: "o", dueAt: now - 5, priority: "low", updatedAt: now }),
        task({
          id: "soon-high",
          title: "sh",
          dueAt: now + 100,
          priority: "critical",
          updatedAt: now - 1,
        }),
      ],
      now,
    ).map((t) => t.id);

    expect(sorted[0]).toBe("over");
    expect(sorted.slice(1, 3)).toEqual(["soon-high", "soon"]);
    expect(sorted[3]).toBe("later");
    expect(sorted[4]).toBe("undated");
  });
});

describe("taskListView display and text filter", () => {
  it("uses provider labels for unknown status/priority", () => {
    expect(
      statusDisplayLabel({
        status: "unknown",
        providerStatus: { displayLabel: "На паузе" },
      }),
    ).toBe("На паузе");
    expect(
      priorityDisplayLabel({
        priority: "unknown",
        providerPriority: "blocker",
      }),
    ).toBe("blocker");
    expect(statusDisplayLabel({ status: "in_progress", providerStatus: null })).toBe("В работе");
    expect(priorityDisplayLabel({ priority: "high", providerPriority: null })).toBe("Высокий");
  });

  it("filters by title, assignee, provider key", () => {
    const rows = [
      task({
        id: "1",
        title: "Alpha",
        externalKey: "TEST-1",
        assignee: principal("bob@example.com"),
      }),
      task({ id: "2", title: "Beta", assignee: principal("alice@example.com") }),
    ];
    expect(filterTasksByText(rows, "test-1").map((t) => t.id)).toEqual(["1"]);
    expect(filterTasksByText(rows, "alice").map((t) => t.id)).toEqual(["2"]);
  });
});
