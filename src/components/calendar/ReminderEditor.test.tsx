import { fireEvent, render, screen } from "@testing-library/react";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { ReminderEditor, formatReminderPolicy } from "./ReminderEditor";

const capabilities = {
  reminders: {
    read: "full", write: "full", multiple: true,
    methods: ["notification", "email"], defaults: "inherit", maxCount: 5,
  },
} as CalendarProviderCapabilities;

describe("ReminderEditor", () => {
  it("preserves an unknown legacy state until the user explicitly chooses a policy", () => {
    const onChange = vi.fn();
    render(<ReminderEditor capabilities={capabilities} value={null} onChange={onChange} />);
    expect(screen.getByRole("option", { name: "Не загружено — оставить без изменений" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Политика напоминаний"), { target: { value: "none" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "none" });
  });

  it("offers capability-supported defaults, multiple reminders and delivery methods", () => {
    const onChange = vi.fn();
    render(<ReminderEditor capabilities={capabilities} value={{
      kind: "custom",
      reminders: [{ method: "notification", trigger: { kind: "before-start", duration: { seconds: 900 } } }],
    }} onChange={onChange} />);

    expect(screen.getByRole("option", { name: "По умолчанию календаря" })).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "Email" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "+ Быстро добавить" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "custom",
      reminders: [
        { method: "notification", trigger: { kind: "before-start", duration: { seconds: 900 } } },
        { method: "notification", trigger: { kind: "before-start", duration: { seconds: 0 } } },
      ],
    });
  });

  it("validates and canonicalizes a custom number with minute/hour/day units", () => {
    const onChange = vi.fn();
    render(<ReminderEditor capabilities={capabilities} value={{ kind: "custom", reminders: [] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Своё время напоминания"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Единица времени напоминания"), { target: { value: "days" } });
    fireEvent.change(screen.getByLabelText("Способ своего напоминания"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Добавить своё" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "custom",
      reminders: [{ method: "email", trigger: { kind: "before-start", duration: { seconds: 172800 } } }],
    });

    fireEvent.change(screen.getByLabelText("Своё время напоминания"), { target: { value: "29" } });
    expect(screen.getByRole("button", { name: "+ Добавить своё" })).toBeDisabled();
  });

  it("formats default, disabled and custom policies for event details", () => {
    expect(formatReminderPolicy(null)).toBeNull();
    expect(formatReminderPolicy({ kind: "inherit" })).toBe("По умолчанию календаря");
    expect(formatReminderPolicy({ kind: "none" })).toBe("Нет");
    expect(formatReminderPolicy({ kind: "custom", reminders: [
      { method: "notification", trigger: { kind: "before-start", duration: { seconds: 3600 } } },
    ] })).toBe("За 1 ч. · уведомление");
  });
});
