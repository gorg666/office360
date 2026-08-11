import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddAccount } from "./AddAccount";
import { useUIStore } from "@/stores/uiStore";

vi.mock("@/services/gmail/auth", () => ({
  startOAuthFlow: vi.fn(),
}));

vi.mock("@/services/db/accounts", () => ({
  insertAccount: vi.fn(),
}));

vi.mock("@/services/gmail/tokenManager", () => ({
  getClientId: vi.fn(),
  getClientSecret: vi.fn(),
}));

function renderAddAccount() {
  useUIStore.setState({ locale: "en" });
  render(<AddAccount onClose={() => {}} onSuccess={() => {}} />);
}

describe("AddAccount", () => {
  it("always offers Google OAuth as a separate provider", () => {
    renderAddAccount();

    fireEvent.click(screen.getByText("Google (Gmail)"));

    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
  });

  it("labels Microsoft-compatible setup as IMAP/SMTP rather than native Exchange", () => {
    renderAddAccount();

    expect(
      screen.getByText("IMAP/SMTP, including Outlook via Microsoft OAuth. This is not native Exchange."),
    ).toBeInTheDocument();
  });

  it("hides native Exchange/Graph until an adapter exists", () => {
    renderAddAccount();

    expect(screen.queryByText("Microsoft 365 / Exchange")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Native Graph/Exchange, shared mailboxes, calendar, and contacts are planned"),
    ).not.toBeInTheDocument();
  });
});
