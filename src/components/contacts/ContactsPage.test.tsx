import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ContactsPage } from "./ContactsPage";
import {
  getAllContactsWithIdentities,
  getContactDirectories,
  getContactLists,
  getRichContact,
  parseVCard,
  saveContactDirectory,
  saveRichContact,
} from "@/services/db/contacts";
import {
  deleteStoredContactAvatar,
  prepareContactAvatarFile,
  saveContactAvatarDataUrl,
} from "@/services/contacts/contactAvatarStorage";

vi.mock("@/services/db/contacts", () => ({
  buildVCardForRichContact: vi.fn(() => "BEGIN:VCARD\nEND:VCARD"),
  deleteContact: vi.fn(),
  deleteContactList: vi.fn(),
  exportContactToVCard: vi.fn(),
  getAllContactsWithIdentities: vi.fn(),
  getContactDirectories: vi.fn(),
  getContactLists: vi.fn(),
  getRichContact: vi.fn(),
  importVCard: vi.fn(),
  parseVCard: vi.fn(),
  saveContactDirectory: vi.fn(),
  saveContactList: vi.fn(),
  saveRichContact: vi.fn(),
}));

vi.mock("@/services/contacts/carddavAddressBook", () => ({
  discoverCardDavUrl: vi.fn(),
  syncCardDavDirectory: vi.fn(),
  testCardDavDirectory: vi.fn(),
}));

vi.mock("@/services/contacts/ldapDirectory", () => ({
  searchLdapDirectory: vi.fn(),
  testLdapDirectory: vi.fn(),
}));

vi.mock("@/services/db/settings", () => ({
  setSecureSetting: vi.fn(),
}));

vi.mock("@/components/ui/ContactAvatar", () => ({
  ContactAvatar: ({
    avatarUrl,
    email,
    name,
  }: {
    avatarUrl?: string | null;
    email?: string | null;
    name?: string | null;
  }) => (
    <div aria-hidden="true" data-testid="contact-avatar" data-avatar-url={avatarUrl ?? ""}>
      {name ?? email ?? "Unknown"}
    </div>
  ),
}));

vi.mock("@/services/contacts/contactAvatarStorage", () => ({
  deleteStoredContactAvatar: vi.fn(),
  prepareContactAvatarFile: vi.fn(),
  saveContactAvatarDataUrl: vi.fn(),
}));

const directories = [
  {
    id: "personal",
    name: "Personal Address Book",
    kind: "local",
    source_type: null,
    source_id: null,
    account_id: null,
    server_url: null,
    username: null,
    auth_ref: null,
    remote_url: null,
    sync_token: null,
    ctag: null,
    sync_status: null,
    sync_error: null,
    read_only: 0,
    ldap_host: null,
    ldap_port: null,
    ldap_security: null,
    ldap_base_dn: null,
    ldap_filter: null,
    ldap_bind_dn: null,
    created_at: null,
    updated_at: null,
    last_synced_at: null,
  },
  {
    id: "collected",
    name: "Collected Addresses",
    kind: "collected",
    source_type: null,
    source_id: null,
    account_id: null,
    server_url: null,
    username: null,
    auth_ref: null,
    remote_url: null,
    sync_token: null,
    ctag: null,
    sync_status: null,
    sync_error: null,
    read_only: 0,
    ldap_host: null,
    ldap_port: null,
    ldap_security: null,
    ldap_base_dn: null,
    ldap_filter: null,
    ldap_bind_dn: null,
    created_at: null,
    updated_at: null,
    last_synced_at: null,
  },
] as const;

const contacts = [
  {
    id: "contact-1",
    email: "long-address@example.com",
    display_name: "Long Address",
    avatar_url: null,
    frequency: 0,
    last_contacted_at: null,
    notes: null,
    directory_id: "personal",
    organization: null,
    title: null,
    identities: [{
      id: "identity-1",
      contact_id: "contact-1",
      email: "long-address@example.com",
      label: "work",
      display_name: null,
      is_primary: 1,
      source_type: "local",
    }],
  },
  {
    id: "contact-2",
    email: "second@example.com",
    display_name: "Second Contact",
    avatar_url: null,
    frequency: 0,
    last_contacted_at: null,
    notes: null,
    directory_id: "personal",
    organization: null,
    title: null,
    identities: [{
      id: "identity-2",
      contact_id: "contact-2",
      email: "second@example.com",
      label: "home",
      display_name: null,
      is_primary: 1,
      source_type: "local",
    }],
  },
];

function richContact(overrides: Record<string, unknown> = {}) {
  return {
    ...contacts[0],
    first_name: "Long",
    last_name: "Address",
    nickname: "LA",
    role: "Decision maker",
    timezone: "Europe/Moscow",
    birthday: "1990-01-02",
    anniversary: "2020-03-04",
    notes: "Important notes",
    organization: "Example Corp",
    title: "Director",
    directory: directories[0],
    read_only: 0,
    methods: [
      {
        id: "method-1",
        contact_id: "contact-1",
        kind: "email",
        value: "long-address@example.com",
        label: "work",
        display_name: null,
        is_primary: 1,
        sort_order: 0,
        source_type: "local",
      },
      {
        id: "method-2",
        contact_id: "contact-1",
        kind: "email",
        value: "very.long.email.address.for.preview@example-company.test",
        label: "home",
        display_name: null,
        is_primary: 0,
        sort_order: 1,
        source_type: "local",
      },
      {
        id: "method-3",
        contact_id: "contact-1",
        kind: "phone",
        value: "+1 555 0100",
        label: "mobile",
        display_name: null,
        is_primary: 1,
        sort_order: 2,
        source_type: "local",
      },
      {
        id: "method-4",
        contact_id: "contact-1",
        kind: "url",
        value: "https://example.com/very/long/profile/path",
        label: "website",
        display_name: null,
        is_primary: 0,
        sort_order: 3,
        source_type: "local",
      },
      {
        id: "method-5",
        contact_id: "contact-1",
        kind: "impp",
        value: "matrix:u/example",
        label: "chat",
        display_name: null,
        is_primary: 0,
        sort_order: 4,
        source_type: "local",
      },
    ],
    addresses: [{
      id: "address-1",
      contact_id: "contact-1",
      label: "office",
      street: "1 Main St",
      city: "Boston",
      region: "MA",
      postal_code: "02110",
      country: "US",
      sort_order: 0,
    }],
    specialDates: [{
      id: "date-1",
      contact_id: "contact-1",
      kind: "custom",
      value: "2024-05-06",
      label: "Contract signed",
      sort_order: 0,
    }],
    ...overrides,
  };
}

const parsedVCard = {
  uid: "vcard-1",
  displayName: "Imported Person",
  firstName: "Imported",
  lastName: "Person",
  nickname: "IP",
  emails: ["imported@example.com"],
  emailLabels: new Map([["imported@example.com", "work"]]),
  phones: [],
  urls: [],
  addresses: [],
  specialDates: [],
  timezone: null,
  notes: null,
  organization: null,
  title: null,
  role: null,
  impps: [],
};

describe("ContactsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(getContactDirectories).mockResolvedValue([...directories]);
    vi.mocked(getAllContactsWithIdentities).mockResolvedValue(contacts as never);
    vi.mocked(getContactLists).mockResolvedValue([]);
    vi.mocked(getRichContact).mockImplementation(async (id) => richContact({ id }) as never);
    vi.mocked(parseVCard).mockReturnValue(parsedVCard as never);
    vi.mocked(saveContactDirectory).mockResolvedValue(directories[0] as never);
    vi.mocked(saveRichContact).mockResolvedValue(richContact({ id: "saved-contact" }) as never);
    vi.mocked(prepareContactAvatarFile).mockResolvedValue("data:image/jpeg;base64,preview");
    vi.mocked(saveContactAvatarDataUrl).mockResolvedValue("/tmp/contact-avatars/avatar.jpg");
    vi.mocked(deleteStoredContactAvatar).mockResolvedValue(undefined);
  });

  it("keeps creation controls in the left address book column", async () => {
    render(<ContactsPage />);

    expect(await screen.findByRole("button", { name: /New contact/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add address book/i })).toBeInTheDocument();
    expect(screen.getByText("All address books")).toBeInTheDocument();
    expect(screen.queryByText("Add directory")).not.toBeInTheDocument();
  });

  it("keeps All address books selected and shows contacts from every directory", async () => {
    vi.mocked(getAllContactsWithIdentities).mockResolvedValue([
      contacts[0],
      { ...contacts[1], directory_id: "collected" },
    ] as never);
    render(<ContactsPage />);

    expect(await screen.findByRole("button", { name: /Long Address long-address@example.com/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Second Contact second@example.com/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /All address books/ }));

    expect(await screen.findByRole("button", { name: /Second Contact second@example.com/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All address books/ })).toHaveClass("bg-accent/10");
  });

  it("opens address book settings in a modal", async () => {
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Add address book/i }));

    expect(await screen.findByRole("heading", { name: "Add address book" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Local/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CardDAV/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /LDAP/i })).toBeInTheDocument();
  });

  it("opens new contact in the right-pane editor instead of a modal", async () => {
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /New contact/i }));

    expect(await screen.findByRole("heading", { name: "New contact" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "New contact" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Address book"), { target: { value: "collected" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByPlaceholderText("email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Create contact/i }));

    await waitFor(() => {
      expect(saveRichContact).toHaveBeenCalledWith(expect.objectContaining({
        directoryId: "collected",
        displayName: "Ada Lovelace",
      }));
    });
  });

  it("opens edit in the right-pane editor and preserves populated fields", async () => {
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/i }));

    expect(await screen.findByRole("heading", { name: "Edit contact" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit contact" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Long Address");
    expect(screen.getByLabelText("First name")).toHaveValue("Long");
    expect(screen.getByLabelText("Last name")).toHaveValue("Address");
    expect(screen.getByLabelText("Nickname")).toHaveValue("LA");
    expect(screen.getByLabelText("Notes")).toHaveValue("Important notes");
  });

  it("renders saved contact avatars in the list and preview", async () => {
    vi.mocked(getAllContactsWithIdentities).mockResolvedValue([
      { ...contacts[0], avatar_url: "/tmp/contact-avatars/avatar.jpg" },
    ] as never);
    vi.mocked(getRichContact).mockResolvedValue(richContact({ avatar_url: "/tmp/contact-avatars/avatar.jpg" }) as never);
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));

    await screen.findByRole("heading", { name: "Long Address" });
    expect(screen.getAllByTestId("contact-avatar").some((avatar) => (
      avatar.getAttribute("data-avatar-url") === "/tmp/contact-avatars/avatar.jpg"
    ))).toBe(true);
  });

  it("saves a contact photo URL from the inline editor", async () => {
    vi.mocked(saveRichContact).mockResolvedValueOnce(richContact({
      avatar_url: "https://example.com/photo.jpg",
    }) as never);
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/i }));
    fireEvent.change(screen.getByLabelText("Photo URL"), { target: { value: "https://example.com/photo.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveRichContact).toHaveBeenCalledWith(expect.objectContaining({
        avatarUrl: "https://example.com/photo.jpg",
      }));
    });
    expect(saveContactAvatarDataUrl).not.toHaveBeenCalled();
  });

  it("stages an uploaded contact photo and persists it only on save", async () => {
    vi.mocked(saveRichContact).mockResolvedValueOnce(richContact({
      avatar_url: "/tmp/contact-avatars/avatar.jpg",
    }) as never);
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/i }));
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload contact photo"), { target: { files: [file] } });

    await waitFor(() => expect(prepareContactAvatarFile).toHaveBeenCalledWith(file));
    expect(saveContactAvatarDataUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveContactAvatarDataUrl).toHaveBeenCalledWith("data:image/jpeg;base64,preview");
      expect(saveRichContact).toHaveBeenCalledWith(expect.objectContaining({
        avatarUrl: "/tmp/contact-avatars/avatar.jpg",
      }));
    });
  });

  it("removes a saved contact photo on save", async () => {
    vi.mocked(getRichContact).mockResolvedValue(richContact({
      avatar_url: "/tmp/contact-avatars/old-avatar.jpg",
    }) as never);
    vi.mocked(saveRichContact).mockResolvedValueOnce(richContact({
      avatar_url: null,
    }) as never);
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/i }));
    fireEvent.click(screen.getByRole("button", { name: "Remove contact photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveRichContact).toHaveBeenCalledWith(expect.objectContaining({
        avatarUrl: null,
      }));
      expect(deleteStoredContactAvatar).toHaveBeenCalledWith("/tmp/contact-avatars/old-avatar.jpg");
    });
  });

  it("removes email rows from the inline editor and saves the reduced address list", async () => {
    const saved = richContact({
      methods: [
        {
          id: "method-1",
          contact_id: "contact-1",
          kind: "email",
          value: "long-address@example.com",
          label: "work",
          display_name: null,
          is_primary: 1,
          sort_order: 0,
          source_type: "local",
        },
      ],
    });
    vi.mocked(saveRichContact).mockResolvedValueOnce(saved as never);
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/i }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove email" }))[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveRichContact).toHaveBeenCalled());
    const savedInput = vi.mocked(saveRichContact).mock.calls.at(-1)?.[0];
    expect(savedInput?.identities).toEqual([expect.objectContaining({ email: "long-address@example.com" })]);
    expect(savedInput?.methods?.filter((method) => method.kind === "email")).toEqual([
      expect.objectContaining({ value: "long-address@example.com" }),
    ]);
    expect(screen.queryByText("very.long.email.address.for.preview@example-company.test")).not.toBeInTheDocument();
  });

  it("updates the preview with newly saved additional fields for the selected contact", async () => {
    vi.mocked(saveRichContact).mockResolvedValueOnce(richContact({ title: "Updated Director" }) as never);
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated Director" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Updated Director")).toBeInTheDocument();
  });

  it("does not silently discard a dirty contact draft when selecting another contact", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /New contact/i }));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Unsaved Draft" } });
    fireEvent.click(screen.getByRole("button", { name: /Second Contact second@example.com/ }));

    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved contact changes?");
    expect(screen.getByRole("heading", { name: "New contact" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Unsaved Draft");
  });

  it("persists resizable contact column widths and resets on double-click", async () => {
    render(<ContactsPage />);

    const handle = await screen.findByRole("separator", { name: "Resize address books column" });
    fireEvent.mouseDown(handle, { clientX: 304 });
    fireEvent.mouseMove(window, { clientX: 360 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("contacts.columnWidths.v1") ?? "{}")).toMatchObject({ directories: 360 });
    });

    fireEvent.doubleClick(handle);

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("contacts.columnWidths.v1") ?? "{}")).toMatchObject({ directories: 304, list: 384 });
    });
  });

  it("opens import as a right-pane wizard instead of a modal", async () => {
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Import/i }));

    expect(await screen.findByRole("heading", { name: "Import contacts" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Import vCard/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CSV \/ TSV/i })).toBeDisabled();
    expect(screen.getAllByText("Coming later").length).toBeGreaterThan(0);
  });

  it("imports vCard into the selected target address book", async () => {
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Import/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Target address book"), { target: { value: "collected" } });
    fireEvent.change(screen.getByLabelText("Paste vCard text"), { target: { value: "BEGIN:VCARD\nEMAIL:imported@example.com\nEND:VCARD" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));

    await waitFor(() => {
      expect(saveRichContact).toHaveBeenCalledWith(expect.objectContaining({
        directoryId: "collected",
        identities: [expect.objectContaining({ email: "imported@example.com" })],
      }));
    });
  });

  it("renders every form-fillable saved field in the contact preview", async () => {
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Long Address long-address@example.com/ }));

    const details = await screen.findByRole("heading", { name: "Long Address" });
    const pane = details.closest("main");
    expect(pane).not.toBeNull();
    const view = within(pane as HTMLElement);

    expect(view.getByText("Long")).toBeInTheDocument();
    expect(view.getByText("Address")).toBeInTheDocument();
    expect(view.getByText("LA")).toBeInTheDocument();
    expect(view.getAllByText("long-address@example.com").length).toBeGreaterThan(0);
    expect(view.getByText("very.long.email.address.for.preview@example-company.test")).toBeInTheDocument();
    expect(view.getByText("+1 555 0100")).toBeInTheDocument();
    expect(view.getByText("https://example.com/very/long/profile/path")).toBeInTheDocument();
    expect(view.getByText("matrix:u/example")).toBeInTheDocument();
    expect(view.getByText("1 Main St, Boston, MA, 02110, US")).toBeInTheDocument();
    expect(view.getByText("Example Corp")).toBeInTheDocument();
    expect(view.getByText("Director")).toBeInTheDocument();
    expect(view.getByText("Decision maker")).toBeInTheDocument();
    expect(view.getByText("Europe/Moscow")).toBeInTheDocument();
    expect(view.getByText("1990-01-02")).toBeInTheDocument();
    expect(view.getByText("2020-03-04")).toBeInTheDocument();
    expect(view.getByText("2024-05-06")).toBeInTheDocument();
    expect(view.getByText("Important notes")).toBeInTheDocument();
  });
});
