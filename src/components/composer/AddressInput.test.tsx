import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personIdentityFromEmail } from "@/services/people";
import { AddressInput } from "./AddressInput";

describe("AddressInput unified people adapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces people search and forwards the active account", async () => {
    const search = vi.fn(async () => ({ people: [], directorySearch: "unsupported" as const }));
    render(<AddressInput accountId="account-1" label="To" addresses={[]} onChange={vi.fn()} search={search} />);
    fireEvent.change(screen.getByRole("combobox", { name: "To" }), { target: { value: "john" } });
    expect(search).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(search).toHaveBeenLastCalledWith({ accountId: "account-1", query: "john", limit: 10 });
  });

  it("resets the debounce during rapid typing", async () => {
    const search = vi.fn(async () => ({ people: [], directorySearch: "unsupported" as const }));
    render(<AddressInput label="To" addresses={[]} onChange={vi.fn()} search={search} />);
    const input = screen.getByRole("combobox", { name: "To" });
    fireEvent.change(input, { target: { value: "jo" } });
    await act(() => vi.advanceTimersByTimeAsync(100));
    fireEvent.change(input, { target: { value: "john" } });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(search).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("keeps rich presentation in the chip while preserving the SMTP email contract", async () => {
    const person = personIdentityFromEmail("anna@example.com", { displayName: "Анна Иванова", source: "contact" });
    const search = vi.fn(async () => ({ people: [person], directorySearch: "unsupported" as const }));
    const onChange = vi.fn();
    render(<AddressInput label="To" addresses={[]} onChange={onChange} search={search} />);
    const input = screen.getByRole("combobox", { name: "To" });
    fireEvent.change(input, { target: { value: "Анна" } });
    await act(() => vi.advanceTimersByTimeAsync(200));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["anna@example.com"]);
  });
});
