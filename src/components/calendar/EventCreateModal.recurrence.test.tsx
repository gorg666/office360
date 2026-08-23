import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventCreateModal } from "./EventCreateModal";

function renderCreate(overrides: { allDay?: boolean; timeZone?: string } = {}) {
  const onCreate = vi.fn();
  const allDay = Boolean(overrides.allDay);
  render(
    <EventCreateModal
      timeZone={overrides.timeZone ?? "UTC"}
      initialValues={allDay
        ? { startTime: "2026-08-27", endTime: "2026-08-27", allDay: true }
        : { startTime: "2026-08-27T10:30", endTime: "2026-08-27T11:30" }}
      onClose={vi.fn()}
      onCreate={onCreate}
    />,
  );
  return onCreate;
}

async function submit(onCreate: ReturnType<typeof vi.fn>) {
  fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Series" } });
  fireEvent.click(screen.getByRole("button", { name: "Создать" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  return onCreate.mock.calls[0]![0] as { recurrenceRule: string | null; attendees: Array<{ email: string; role: string }>; allDay?: boolean };
}

function setPreset(value: string) {
  fireEvent.change(screen.getByLabelText("Правило повторения"), { target: { value } });
}

describe("EventCreateModal recurring create", () => {
  it.each([
    ["daily", "FREQ=DAILY"],
    ["weekly", "FREQ=WEEKLY"],
    ["monthly", "FREQ=MONTHLY"],
    ["yearly", "FREQ=YEARLY"],
    ["weekdays", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
  ] as const)("saves the %s preset through the existing create contract", async (preset, rule) => {
    const onCreate = renderCreate();
    setPreset(preset);
    const payload = await submit(onCreate);
    expect(payload.recurrenceRule).toBe(rule);
  });

  it("saves a custom biweekly Tuesday/Thursday rule", async () => {
    const onCreate = renderCreate();
    setPreset("custom");
    fireEvent.change(screen.getByLabelText("Интервал повторения"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Вт"));
    fireEvent.click(screen.getByLabelText("Чт"));
    expect(screen.getByTestId("recurrence-summary")).toHaveTextContent("Каждые 2 недели по вторникам и четвергам");
    const payload = await submit(onCreate);
    expect(payload.recurrenceRule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH");
  });

  it("saves an until date using event wall-clock", async () => {
    const onCreate = renderCreate();
    setPreset("daily");
    fireEvent.change(screen.getByLabelText("Окончание повторения"), { target: { value: "until" } });
    fireEvent.change(screen.getByLabelText("Дата окончания повторения"), { target: { value: "2026-09-30" } });
    const payload = await submit(onCreate);
    expect(payload.recurrenceRule).toContain("FREQ=DAILY");
    expect(payload.recurrenceRule).toContain("UNTIL=20260930T103000Z");
  });

  it("saves a count end condition", async () => {
    const onCreate = renderCreate();
    setPreset("monthly");
    fireEvent.change(screen.getByLabelText("Окончание повторения"), { target: { value: "count" } });
    fireEvent.change(screen.getByLabelText("Число повторений"), { target: { value: "8" } });
    const payload = await submit(onCreate);
    expect(payload.recurrenceRule).toBe("FREQ=MONTHLY;COUNT=8");
  });

  it("saves all-day recurrence without host-local Date arithmetic", async () => {
    const onCreate = renderCreate({ allDay: true, timeZone: "America/New_York" });
    setPreset("weekly");
    fireEvent.change(screen.getByLabelText("Окончание повторения"), { target: { value: "until" } });
    fireEvent.change(screen.getByLabelText("Дата окончания повторения"), { target: { value: "2026-10-06" } });
    const payload = await submit(onCreate);
    expect(payload.allDay).toBe(true);
    expect(payload.recurrenceRule).toMatch(/^FREQ=WEEKLY;UNTIL=20261006$/);
  });

  it("keeps required/optional roles on the create payload and rejects duplicates", async () => {
    const onCreate = renderCreate();
    fireEvent.change(screen.getByLabelText("Адрес участника"), { target: { value: "req@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    fireEvent.change(screen.getByLabelText("Адрес участника"), { target: { value: "opt@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    fireEvent.change(screen.getByLabelText("Роль opt@example.com"), { target: { value: "optional" } });
    fireEvent.change(screen.getByLabelText("Адрес участника"), { target: { value: "REQ@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Этот участник уже добавлен.");
    expect(screen.getAllByTestId("participant-row")).toHaveLength(2);
    const payload = await submit(onCreate);
    expect(payload.attendees).toEqual([
      { email: "req@example.com", role: "required" },
      { email: "opt@example.com", role: "optional" },
    ]);
  });

  it("blocks invalid custom weekly create before calling onCreate", () => {
    const onCreate = renderCreate();
    setPreset("custom");
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Broken" } });
    expect(screen.getByTestId("recurrence-editor")).toHaveTextContent(
      "Для еженедельного повторения выберите хотя бы один день.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
