import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(),
    selectFirstBy: vi.fn(),
  };
});

import { getDb, selectFirstBy } from "@/services/db/connection";
import {
  updateInvitationRsvp,
  upsertCalendarInvitation,
  type DbCalendarInvitation,
} from "./calendarInvitations";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

const makeInvitation = (overrides: Partial<DbCalendarInvitation> = {}): DbCalendarInvitation => ({
  id: "invite-1",
  account_id: "acc-1",
  thread_id: "thread-1",
  message_id: "msg-1",
  event_uid: "uid-1",
  recurrence_id: null,
  recurrence_key: "",
  method: "REQUEST",
  sequence: 1,
  status: "confirmed",
  summary: "Planning",
  description: null,
  location: null,
  start_time: 1000,
  end_time: 2000,
  is_all_day: 0,
  timezone_id: null,
  timezone_warning: 0,
  organizer_email: "lead@example.com",
  attendees_json: null,
  rsvp_status: "needs_action",
  rsvp_queue_status: null,
  queued_operation_id: null,
  calendar_event_id: null,
  raw_ical: "BEGIN:VCALENDAR",
  source_hash: "body:abc",
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

describe("calendarInvitations service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("upserts an invitation by account UID and recurrence key", async () => {
    const inserted = makeInvitation({ id: "generated-id", sequence: 2 });
    vi.mocked(selectFirstBy)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(inserted);

    const result = await upsertCalendarInvitation({
      accountId: "acc-1",
      threadId: "thread-1",
      messageId: "msg-1",
      eventUid: "uid-1",
      recurrenceId: null,
      method: "REQUEST",
      sequence: 2,
      status: "confirmed",
      summary: "Planning",
      startTime: 1000,
      endTime: 2000,
      rawIcal: "BEGIN:VCALENDAR",
      sourceHash: "body:abc",
    });

    expect(result).toBe(inserted);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT(account_id, event_uid, recurrence_key) DO UPDATE");
    expect(params[1]).toBe("acc-1");
    expect(params[4]).toBe("uid-1");
    expect(params[6]).toBe("");
    expect(params[8]).toBe(2);
  });

  it("keeps a newer stored sequence over an older update", async () => {
    const existing = makeInvitation({ sequence: 5 });
    vi.mocked(selectFirstBy).mockResolvedValueOnce(existing);

    const result = await upsertCalendarInvitation({
      accountId: "acc-1",
      threadId: "thread-1",
      messageId: "msg-older",
      eventUid: "uid-1",
      sequence: 4,
      rawIcal: "BEGIN:VCALENDAR",
      sourceHash: "body:older",
    });

    expect(result).toBe(existing);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("updates RSVP and queue state", async () => {
    await updateInvitationRsvp("invite-1", "accepted", "queued", "op-1");

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE calendar_invitations");
    expect(params).toEqual(["accepted", "queued", "op-1", "invite-1"]);
  });
});
