import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";
import type { RecurrenceScopeChoice } from "./recurrenceEditScope";

const choices: RecurrenceScopeChoice[] = [
  { scope: "single", enabled: true, label: "Только это событие", description: "Удалить только выбранное событие из серии" },
  { scope: "series", enabled: true, label: "Всю серию", description: "Удалить всю серию событий" },
];

describe("RecurrenceScopeDialog", () => {
  it("confirms the selected edit scope", () => {
    const onConfirm = vi.fn();
    render(<RecurrenceScopeDialog intent="update" choices={choices} busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText("Изменить повторяющееся событие")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("recurrence-scope-series"));
    fireEvent.submit(screen.getByTestId("recurrence-scope-dialog"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("series");
  });

  it("marks delete as destructive and cancels without confirming", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<RecurrenceScopeDialog intent="delete" choices={choices} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByText("Удалить повторяющееся событие")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onCancel = vi.fn();
    render(<RecurrenceScopeDialog intent="update" choices={choices} busy={false} onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not offer this-and-future when it is absent from choices", () => {
    render(<RecurrenceScopeDialog intent="update" choices={choices} busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText("Это и последующие события")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recurrence-scope-this-and-future")).not.toBeInTheDocument();
  });
});
