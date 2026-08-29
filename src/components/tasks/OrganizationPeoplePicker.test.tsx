import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrganizationPeoplePicker } from "./OrganizationPeoplePicker";

describe("OrganizationPeoplePicker", () => {
  it("lists name/email/job title and blocks manual email", async () => {
    const onChange = vi.fn();
    const searchFn = vi.fn().mockResolvedValue({
      people: [
        {
          id: "dir:org:1",
          email: "bob@org.com",
          displayName: "Bob Builder",
          firstName: "Bob",
          lastName: "Builder",
          jobTitle: "Engineer",
          department: "Platform",
          source: "organization-directory",
          sources: ["organization-directory"],
          providerId: "1",
          organization: "org",
        },
      ],
      directorySearch: "supported",
    });

    render(
      <OrganizationPeoplePicker
        accountId="acc"
        organizationId="org"
        value={null}
        onChange={onChange}
        searchFn={searchFn}
      />,
    );

    expect(screen.getByText(/Ручной email запрещён/)).toBeInTheDocument();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByText("Bob Builder")).toBeInTheDocument());
    expect(screen.getByText("bob@org.com")).toBeInTheDocument();
    expect(screen.getByText(/Engineer · Platform/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ email: "bob@org.com", source: "organization-directory" }),
    );
  });

  it("shows directory permission-denied state", async () => {
    const searchFn = vi.fn().mockResolvedValue({
      people: [],
      directorySearch: "permission-denied",
      directoryError: "Не удалось подтвердить сотрудника организации",
    });
    render(
      <OrganizationPeoplePicker
        accountId="acc"
        organizationId="org"
        value={null}
        onChange={vi.fn()}
        searchFn={searchFn}
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText(/Не удалось подтвердить сотрудника организации/)).toBeInTheDocument(),
    );
  });
});
