import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personIdentityFromEmail, type PeopleSearchResult } from "@/services/people";
import { PeoplePicker, type PeopleSearch } from "./PeoplePicker";

const directoryPerson = personIdentityFromEmail("anna@example.com", {
  displayName: "Анна Иванова", jobTitle: "Архитектор", department: "Платформа", source: "organization-directory",
});

describe("PeoplePicker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("supports debounced search, keyboard choice, rich display and a removable chip", async () => {
    const search = vi.fn<PeopleSearch>(async (): Promise<PeopleSearchResult> => ({ people: [directoryPerson], directorySearch: "supported" }));
    const onChange = vi.fn();
    const view = render(<PeoplePicker label="Получатели" selected={[]} onChange={onChange} search={search} />);
    const input = screen.getByRole("combobox", { name: "Получатели" });
    fireEvent.change(input, { target: { value: "Анна" } });
    expect(search).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(search).toHaveBeenLastCalledWith({ accountId: undefined, query: "Анна", limit: 10 });
    expect(screen.getByText("Архитектор · Платформа")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith([directoryPerson]);

    view.rerender(<PeoplePicker label="Получатели" selected={[directoryPerson]} onChange={onChange} search={search} />);
    expect(screen.getByTitle("anna@example.com")).toHaveTextContent("Анна Иванова");
    fireEvent.click(screen.getByRole("button", { name: "Удалить anna@example.com" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("accepts a valid manual email and surfaces directory fallback without blocking it", async () => {
    const manual = personIdentityFromEmail("manual@example.com");
    const search = vi.fn<PeopleSearch>(async () => ({
      people: [manual], directorySearch: "permission-denied",
    }));
    const onChange = vi.fn();
    render(<PeoplePicker label="Участники" selected={[]} onChange={onChange} search={search} />);
    const input = screen.getByRole("combobox", { name: "Участники" });
    fireEvent.change(input, { target: { value: "manual@example.com" } });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.getByText(/Каталог организации недоступен/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith([manual]);
  });

  it("supports Escape and Backspace keyboard behavior", async () => {
    const search = vi.fn<PeopleSearch>(async () => ({ people: [directoryPerson], directorySearch: "supported" }));
    const onChange = vi.fn();
    render(<PeoplePicker label="Люди" selected={[directoryPerson]} onChange={onChange} search={search} />);
    const input = screen.getByRole("combobox", { name: "Люди" });
    fireEvent.focus(input);
    await act(() => vi.advanceTimersByTimeAsync(200));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
