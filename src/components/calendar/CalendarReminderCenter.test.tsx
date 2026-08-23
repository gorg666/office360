import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  snooze: vi.fn(),
  dismiss: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/services/calendar/reminderDelivery", () => ({
  CALENDAR_REMINDER_DELIVERED_EVENT: "office360-calendar-reminder-delivered",
  CALENDAR_REMINDER_STATUS_EVENT: "office360-calendar-reminder-status",
  CALENDAR_REMINDER_SNOOZE_PRESETS_MINUTES: [5, 10, 30, 60],
  loadUnhandledCalendarReminders: mocks.load,
  snoozeCalendarReminder: mocks.snooze,
  dismissCalendarReminder: mocks.dismiss,
}));
vi.mock("@/router/navigate", () => ({ navigateToLabel: mocks.navigate }));

import { CalendarReminderCenter } from "./CalendarReminderCenter";

const delivery = {
  deliveryKey: "delivery-1",
  title: "Planning",
  body: "23 Aug, 10:00 · Work",
  scheduledAt: 2_000_000,
  privacyProtected: false,
};

describe("CalendarReminderCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue([]);
    mocks.snooze.mockResolvedValue(undefined);
    mocks.dismiss.mockResolvedValue(undefined);
  });

  it("renders one internal action surface and dedupes repeated delivery events", async () => {
    render(<CalendarReminderCenter />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
      window.dispatchEvent(new CustomEvent("office360-calendar-reminder-delivered", { detail: delivery }));
      window.dispatchEvent(new CustomEvent("office360-calendar-reminder-delivered", { detail: delivery }));
    });
    expect(await screen.findAllByRole("alert", { name: "Напоминание календаря" })).toHaveLength(1);
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("offers all approved snooze presets and removes the handled card", async () => {
    mocks.load.mockResolvedValue([delivery]);
    render(<CalendarReminderCenter />);
    fireEvent.click(await screen.findByRole("button", { name: "Через 10 мин" }));
    await waitFor(() => expect(mocks.snooze).toHaveBeenCalledWith("delivery-1", 10));
    await waitFor(() => expect(screen.queryByText("Planning")).not.toBeInTheDocument());
  });

  it("dismisses locally without provider I/O", async () => {
    mocks.load.mockResolvedValue([delivery]);
    render(<CalendarReminderCenter />);
    fireEvent.click(await screen.findByRole("button", { name: "Отклонить" }));
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledWith("delivery-1"));
  });

  it("shows a safe diagnostic when OS permission is denied", async () => {
    render(<CalendarReminderCenter />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("office360-calendar-reminder-status", {
        detail: { status: "permission-denied", permission: "denied" },
      }));
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Системные уведомления отключены");
  });
});
