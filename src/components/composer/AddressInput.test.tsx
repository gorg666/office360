import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import { AddressInput } from "./AddressInput";

// Mock the contacts search
const mockSearchContacts = vi.fn().mockResolvedValue([]);
vi.mock("@/services/db/contacts", () => ({
  searchContacts: (...args: unknown[]) => mockSearchContacts(...args),
}));

describe("AddressInput debounce behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchContacts.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not search immediately on input change", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });
    fireEvent.change(input, { target: { value: "jo" } });

    // Should NOT have searched yet (debounce not elapsed)
    expect(mockSearchContacts).not.toHaveBeenCalled();
  });

  it("should search after debounce period", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });
    fireEvent.change(input, { target: { value: "jo" } });

    // Advance past 200ms debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mockSearchContacts).toHaveBeenCalledWith("jo", 5);
  });

  it("should not search when input is too short", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });
    fireEvent.change(input, { target: { value: "j" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mockSearchContacts).not.toHaveBeenCalled();
  });

  it("should debounce rapid keystrokes", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });

    // Simulate rapid typing — each keystroke resets the debounce
    fireEvent.change(input, { target: { value: "jo" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: "joh" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(input, { target: { value: "john" } });

    // At this point 200ms haven't passed since the last change
    expect(mockSearchContacts).not.toHaveBeenCalled();

    // Now advance past debounce from last keystroke
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mockSearchContacts).toHaveBeenCalledTimes(1);
    expect(mockSearchContacts).toHaveBeenCalledWith("john", 5);
  });

  it("adds the matched identity email from autocomplete", async () => {
    mockSearchContacts.mockResolvedValueOnce([
      {
        id: "c-1",
        email: "primary@example.com",
        identity_email: "alias@example.com",
        display_name: "Alice Example",
        avatar_url: null,
        frequency: 8,
        last_contacted_at: null,
        notes: null,
      },
    ]);
    const onChange = vi.fn();
    const { getByRole } = render(
      <AddressInput label="To" addresses={[]} onChange={onChange} />,
    );

    const input = getByRole("textbox", { name: "To" });
    fireEvent.change(input, { target: { value: "alias" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    fireEvent.click(screen.getByText("Alice Example"));

    expect(onChange).toHaveBeenCalledWith(["alias@example.com"]);
  });
});
