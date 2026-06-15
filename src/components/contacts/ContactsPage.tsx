import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import {
  Download,
  FolderSync,
  Globe,
  Import,
  List,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ContactAvatar } from "@/components/ui/ContactAvatar";
import { Modal } from "@/components/ui/Modal";
import {
  buildVCardForRichContact,
  deleteContact,
  deleteContactList,
  exportContactToVCard,
  getAllContactsWithIdentities,
  getContactDirectories,
  getContactLists,
  getRichContact,
  parseVCard,
  saveContactDirectory,
  saveContactList,
  saveRichContact,
  type ContactAddressInput,
  type ContactDirectory,
  type ContactDirectoryKind,
  type ContactListWithMembers,
  type ContactMethodInput,
  type ContactSpecialDateInput,
  type ManagedContact,
  type ParsedVCardContact,
  type RichContact,
} from "@/services/db/contacts";
import {
  discoverCardDavUrl,
  syncCardDavDirectory,
  testCardDavDirectory,
} from "@/services/contacts/carddavAddressBook";
import { searchLdapDirectory, testLdapDirectory, type LdapContactResult } from "@/services/contacts/ldapDirectory";
import {
  deleteStoredContactAvatar,
  prepareContactAvatarFile,
  saveContactAvatarDataUrl,
} from "@/services/contacts/contactAvatarStorage";
import { setSecureSetting } from "@/services/db/settings";

type Mode = "view" | "newContact" | "editContact" | "list" | "import";
type ContactEditorMode = "new" | "edit";
type ImportFormat = "vcard" | "csv" | "ldif" | "sqlite" | "mork";
type ImportStep = 1 | 2 | 3;

const FIELD_CLASS = "w-full px-2 py-1.5 bg-bg-primary border border-border-primary rounded text-xs text-text-primary outline-none focus:border-accent";
const SELECT_CLASS = `${FIELD_CLASS} appearance-auto`;
const CONTACT_COLUMN_WIDTHS_KEY = "contacts.columnWidths.v1";
const DEFAULT_COLUMN_WIDTHS = { directories: 304, list: 384 };
const CONTACT_RESIZE_HANDLE_WIDTH = 6;
const CONTACT_DETAIL_MIN_WIDTH = 440;
const COMPACT_COLUMN_MIN_WIDTHS = { directories: 220, list: 260 };
const COLUMN_LIMITS = {
  directories: { min: 240, max: 420 },
  list: { min: 300, max: 560 },
};

interface ContactFormState {
  displayName: string;
  firstName: string;
  lastName: string;
  nickname: string;
  organization: string;
  title: string;
  role: string;
  timezone: string;
  notes: string;
  avatarUrl: string;
  avatarDataUrl: string | null;
  avatarRemoved: boolean;
  birthday: string;
  anniversary: string;
  emails: ContactMethodInput[];
  phones: ContactMethodInput[];
  urls: ContactMethodInput[];
  impps: ContactMethodInput[];
  addresses: ContactAddressInput[];
  dates: ContactSpecialDateInput[];
}

interface ContactDirectoryDraft {
  kind: ContactDirectoryKind;
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  ldapHost: string;
  ldapPort: string;
  ldapSecurity: string;
  ldapBaseDn: string;
  ldapFilter: string;
  ldapBindDn: string;
}

interface ContactColumnWidths {
  directories: number;
  list: number;
}

interface ImportPreview {
  parsed: ParsedVCardContact | null;
  count: number;
  errors: string[];
}

const blankContactForm = (): ContactFormState => ({
  displayName: "",
  firstName: "",
  lastName: "",
  nickname: "",
  organization: "",
  title: "",
  role: "",
  timezone: "",
  notes: "",
  avatarUrl: "",
  avatarDataUrl: null,
  avatarRemoved: false,
  birthday: "",
  anniversary: "",
  emails: [{ kind: "email", value: "", label: "home", isPrimary: true }],
  phones: [],
  urls: [],
  impps: [],
  addresses: [],
  dates: [],
});

const blankDirectoryDraft = (kind: ContactDirectoryKind = "local"): ContactDirectoryDraft => ({
  kind,
  name: "",
  serverUrl: "",
  username: "",
  password: "",
  ldapHost: "",
  ldapPort: "389",
  ldapSecurity: "plain",
  ldapBaseDn: "",
  ldapFilter: "(|(mail=*{query}*)(cn=*{query}*))",
  ldapBindDn: "",
});

const blankImportPreview = (): ImportPreview => ({ parsed: null, count: 0, errors: [] });

const importFormats: Array<{ id: ImportFormat; label: string; description: string; enabled: boolean }> = [
  { id: "vcard", label: "vCard", description: ".vcf contact cards", enabled: true },
  { id: "csv", label: "CSV / TSV", description: "Coming later", enabled: false },
  { id: "ldif", label: "LDIF", description: "Coming later", enabled: false },
  { id: "sqlite", label: "SQLite", description: "Coming later", enabled: false },
  { id: "mork", label: "Mork", description: "Coming later", enabled: false },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readColumnWidths(): ContactColumnWidths {
  if (typeof window === "undefined") return DEFAULT_COLUMN_WIDTHS;
  try {
    const raw = window.localStorage.getItem(CONTACT_COLUMN_WIDTHS_KEY);
    if (!raw) return DEFAULT_COLUMN_WIDTHS;
    const parsed = JSON.parse(raw) as Partial<ContactColumnWidths>;
    return {
      directories: clamp(Number(parsed.directories) || DEFAULT_COLUMN_WIDTHS.directories, COLUMN_LIMITS.directories.min, COLUMN_LIMITS.directories.max),
      list: clamp(Number(parsed.list) || DEFAULT_COLUMN_WIDTHS.list, COLUMN_LIMITS.list.min, COLUMN_LIMITS.list.max),
    };
  } catch {
    return DEFAULT_COLUMN_WIDTHS;
  }
}

function fitColumnWidthsToContainer(width: number, columnWidths: ContactColumnWidths): ContactColumnWidths {
  if (!width) return columnWidths;
  const handlesWidth = CONTACT_RESIZE_HANDLE_WIDTH * 2;
  const maxContentWidth = Math.max(0, width - handlesWidth - CONTACT_DETAIL_MIN_WIDTH);
  let directories = columnWidths.directories;
  let list = columnWidths.list;
  let overflow = directories + list - maxContentWidth;
  if (overflow <= 0) return columnWidths;

  const listReduction = Math.min(overflow, Math.max(0, list - COMPACT_COLUMN_MIN_WIDTHS.list));
  list -= listReduction;
  overflow -= listReduction;

  const directoryReduction = Math.min(overflow, Math.max(0, directories - COMPACT_COLUMN_MIN_WIDTHS.directories));
  directories -= directoryReduction;

  return { directories, list };
}

function serializeContactForm(form: ContactFormState): string {
  return JSON.stringify(form);
}

function contactFormFromParsedVCard(parsed: ParsedVCardContact): ContactFormState {
  return {
    displayName: parsed.displayName ?? "",
    firstName: parsed.firstName ?? "",
    lastName: parsed.lastName ?? "",
    nickname: parsed.nickname ?? "",
    organization: parsed.organization ?? "",
    title: parsed.title ?? "",
    role: parsed.role ?? "",
    timezone: parsed.timezone ?? "",
    notes: parsed.notes ?? "",
    avatarUrl: "",
    avatarDataUrl: null,
    avatarRemoved: false,
    birthday: parsed.specialDates.find((date) => date.kind === "birthday")?.value ?? "",
    anniversary: parsed.specialDates.find((date) => date.kind === "anniversary")?.value ?? "",
    emails: parsed.emails.map((email, index) => ({
      kind: "email",
      value: email,
      label: parsed.emailLabels.get(email) ?? "",
      isPrimary: index === 0,
    })),
    phones: parsed.phones,
    urls: parsed.urls,
    impps: parsed.impps,
    addresses: parsed.addresses,
    dates: parsed.specialDates.filter((date) => date.kind !== "birthday" && date.kind !== "anniversary"),
  };
}

function formFromContact(contact: RichContact): ContactFormState {
  const emails = contact.methods.filter((method) => method.kind === "email");
  return {
    displayName: contact.display_name ?? "",
    firstName: contact.first_name ?? "",
    lastName: contact.last_name ?? "",
    nickname: contact.nickname ?? "",
    organization: contact.organization ?? "",
    title: contact.title ?? "",
    role: contact.role ?? "",
    timezone: contact.timezone ?? "",
    notes: contact.notes ?? "",
    avatarUrl: contact.avatar_url ?? "",
    avatarDataUrl: null,
    avatarRemoved: false,
    birthday: contact.birthday ?? contact.specialDates.find((date) => date.kind === "birthday")?.value ?? "",
    anniversary: contact.anniversary ?? contact.specialDates.find((date) => date.kind === "anniversary")?.value ?? "",
    emails: emails.length > 0
      ? emails.map((method) => ({ ...method, isPrimary: method.is_primary === 1 }))
      : contact.identities.map((identity) => ({
        kind: "email",
        value: identity.email,
        label: identity.label,
        displayName: identity.display_name,
        isPrimary: identity.is_primary === 1,
      })),
    phones: contact.methods.filter((method) => method.kind === "phone").map((method) => ({ ...method, isPrimary: method.is_primary === 1 })),
    urls: contact.methods.filter((method) => method.kind === "url").map((method) => ({ ...method, isPrimary: method.is_primary === 1 })),
    impps: contact.methods.filter((method) => method.kind === "impp").map((method) => ({ ...method, isPrimary: method.is_primary === 1 })),
    addresses: contact.addresses.map((address) => ({
      label: address.label,
      street: address.street,
      city: address.city,
      region: address.region,
      postalCode: address.postal_code,
      country: address.country,
      sortOrder: address.sort_order,
    })),
    dates: contact.specialDates
      .filter((date) => date.kind !== "birthday" && date.kind !== "anniversary")
      .map((date) => ({ kind: date.kind, value: date.value, label: date.label, sortOrder: date.sort_order })),
  };
}

export function ContactsPage() {
  const [directories, setDirectories] = useState<ContactDirectory[]>([]);
  const [contacts, setContacts] = useState<ManagedContact[]>([]);
  const [lists, setLists] = useState<ContactListWithMembers[]>([]);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>("personal");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [richContact, setRichContact] = useState<RichContact | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ContactFormState>(() => blankContactForm());
  const [formBaseline, setFormBaseline] = useState(() => serializeContactForm(blankContactForm()));
  const [contactFormDirectoryId, setContactFormDirectoryId] = useState<string>("personal");
  const [contactEditorMode, setContactEditorMode] = useState<ContactEditorMode>("new");
  const [isDirectoryModalOpen, setIsDirectoryModalOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [directoryDraft, setDirectoryDraft] = useState<ContactDirectoryDraft>(() => blankDirectoryDraft());
  const [importStep, setImportStep] = useState<ImportStep>(1);
  const [importFormat, setImportFormat] = useState<ImportFormat>("vcard");
  const [importDirectoryId, setImportDirectoryId] = useState("personal");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview>(() => blankImportPreview());
  const [listDraft, setListDraft] = useState({ name: "", nickname: "", description: "", members: "" });
  const [ldapResults, setLdapResults] = useState<LdapContactResult[]>([]);
  const [columnWidths, setColumnWidths] = useState<ContactColumnWidths>(() => readColumnWidths());
  const skipNextContactReloadId = useRef<string | null>(null);
  const contactsShellRef = useRef<HTMLDivElement | null>(null);
  const [contactsShellWidth, setContactsShellWidth] = useState(0);

  const load = useCallback(async () => {
    const [nextDirectories, nextContacts, nextLists] = await Promise.all([
      getContactDirectories(),
      getAllContactsWithIdentities(2000),
      getContactLists(),
    ]);
    setDirectories(nextDirectories);
    setContacts(nextContacts);
    setLists(nextLists);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedContactId) {
      setRichContact(null);
      return;
    }
    if (skipNextContactReloadId.current === selectedContactId) {
      skipNextContactReloadId.current = null;
      return;
    }
    void getRichContact(selectedContactId).then((contact) => {
      setRichContact(contact);
      if (contact && mode !== "editContact") {
        const nextForm = formFromContact(contact);
        setForm(nextForm);
        setFormBaseline(serializeContactForm(nextForm));
      }
    });
  }, [mode, selectedContactId]);

  useEffect(() => {
    window.localStorage.setItem(CONTACT_COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    const node = contactsShellRef.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      setContactsShellWidth(node.getBoundingClientRect().width);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setContactsShellWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(node);
    setContactsShellWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (selectedDirectoryId && contact.directory_id !== selectedDirectoryId) return false;
      if (!q) return true;
      return [
        contact.display_name,
        contact.email,
        contact.organization,
        contact.title,
        ...contact.identities.map((identity) => identity.email),
      ].some((value) => value?.toLowerCase().includes(q));
    });
  }, [contacts, query, selectedDirectoryId]);

  const directoryLists = useMemo(
    () => lists.filter((list) => !selectedDirectoryId || list.directory_id === selectedDirectoryId),
    [lists, selectedDirectoryId],
  );

  const selectedDirectory = directories.find((directory) => directory.id === selectedDirectoryId) ?? null;
  const selectedList = lists.find((list) => list.id === selectedListId) ?? null;
  const contactFormDirectory = directories.find((directory) => directory.id === contactFormDirectoryId) ?? selectedDirectory;
  const contactFormReadOnly = contactEditorMode === "edit"
    ? richContact?.read_only === 1 || contactFormDirectory?.read_only === 1
    : contactFormDirectory?.read_only === 1;
  const fittedColumnWidths = fitColumnWidthsToContainer(contactsShellWidth, columnWidths);
  const isContactEditorOpen = mode === "newContact" || mode === "editContact";
  const isContactFormDirty = isContactEditorOpen && serializeContactForm(form) !== formBaseline;

  const confirmDiscardContactDraft = () => {
    if (!isContactFormDirty) return true;
    return window.confirm("Discard unsaved contact changes?");
  };

  const setContactFormWithBaseline = (nextForm: ContactFormState) => {
    setForm(nextForm);
    setFormBaseline(serializeContactForm(nextForm));
  };

  const startColumnResize = (column: keyof ContactColumnWidths, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    const limits = COLUMN_LIMITS[column];
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      setColumnWidths((current) => ({
        ...current,
        [column]: clamp(startWidth + delta, limits.min, limits.max),
      }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetColumnWidths = () => setColumnWidths(DEFAULT_COLUMN_WIDTHS);

  const startNewContact = () => {
    if (!confirmDiscardContactDraft()) return;
    const nextForm = blankContactForm();
    setSelectedContactId(null);
    setSelectedListId(null);
    setRichContact(null);
    setContactFormWithBaseline(nextForm);
    setContactFormDirectoryId(selectedDirectoryId ?? directories[0]?.id ?? "personal");
    setContactEditorMode("new");
    setMode("newContact");
  };

  const startEditContact = () => {
    if (!richContact) return;
    if (!confirmDiscardContactDraft()) return;
    setContactFormWithBaseline(formFromContact(richContact));
    setContactFormDirectoryId(richContact.directory_id ?? selectedDirectoryId ?? "personal");
    setContactEditorMode("edit");
    setMode("editContact");
  };

  const startNewList = () => {
    if (!confirmDiscardContactDraft()) return;
    setMode("list");
    setSelectedContactId(null);
    setSelectedListId(null);
    setListDraft({ name: "", nickname: "", description: "", members: "" });
  };

  const selectContact = (contactId: string) => {
    if (!confirmDiscardContactDraft()) return;
    setSelectedContactId(contactId);
    setSelectedListId(null);
    setMode("view");
  };

  const selectList = (list: ContactListWithMembers) => {
    if (!confirmDiscardContactDraft()) return;
    setSelectedListId(list.id);
    setSelectedContactId(null);
    setRichContact(null);
    setMode("list");
    setListDraft({
      name: list.name,
      nickname: list.nickname ?? "",
      description: list.description ?? "",
      members: list.members.map((member) => member.display_name ? `${member.display_name} <${member.email}>` : member.email).join(", "),
    });
  };

  const selectDirectory = (directoryId: string | null) => {
    if (!confirmDiscardContactDraft()) return;
    setSelectedDirectoryId(directoryId);
    setSelectedContactId(null);
    setSelectedListId(null);
    setMode("view");
  };

  const startImport = () => {
    if (!confirmDiscardContactDraft()) return;
    setSelectedContactId(null);
    setSelectedListId(null);
    setImportStep(1);
    setImportFormat("vcard");
    setImportDirectoryId(selectedDirectoryId ?? directories[0]?.id ?? "personal");
    setImportPreview(blankImportPreview());
    setMode("import");
  };

  const saveContact = async () => {
    const emails = form.emails.filter((email) => email.value.trim());
    if (emails.length === 0) {
      setStatus("Add at least one email address.");
      return;
    }
    if (contactFormReadOnly) {
      setStatus("This address book is read-only.");
      return;
    }
    const previousAvatarUrl = contactEditorMode === "edit" ? richContact?.avatar_url ?? null : null;
    let nextAvatarUrl = form.avatarRemoved ? null : form.avatarUrl.trim() || null;
    if (form.avatarDataUrl) {
      nextAvatarUrl = await saveContactAvatarDataUrl(form.avatarDataUrl);
    }
    const saved = await saveRichContact({
      id: contactEditorMode === "edit" ? richContact?.id : undefined,
      directoryId: contactFormDirectoryId || selectedDirectoryId || "personal",
      displayName: form.displayName || `${form.firstName} ${form.lastName}`.trim() || null,
      avatarUrl: nextAvatarUrl,
      firstName: form.firstName || null,
      lastName: form.lastName || null,
      nickname: form.nickname || null,
      organization: form.organization || null,
      title: form.title || null,
      role: form.role || null,
      timezone: form.timezone || null,
      notes: form.notes || null,
      birthday: form.birthday || null,
      anniversary: form.anniversary || null,
      identities: emails.map((email, index) => ({
        email: email.value,
        label: email.label,
        displayName: email.displayName,
        isPrimary: email.isPrimary === true || index === 0,
      })),
      primaryEmail: emails.find((email) => email.isPrimary)?.value ?? emails[0]?.value ?? null,
      methods: [
        ...emails,
        ...form.phones,
        ...form.urls,
        ...form.impps,
      ],
      addresses: form.addresses,
      specialDates: form.dates,
      sourceType: contactFormDirectory?.kind === "carddav" ? "carddav" : "local",
    });
    if (previousAvatarUrl && previousAvatarUrl !== nextAvatarUrl) {
      await deleteStoredContactAvatar(previousAvatarUrl);
    }
    setStatus("Contact saved.");
    setRichContact(saved);
    setContactFormWithBaseline(formFromContact(saved));
    skipNextContactReloadId.current = saved.id;
    setSelectedContactId(saved.id);
    setSelectedDirectoryId(saved.directory_id ?? contactFormDirectoryId);
    setMode("view");
    await load();
  };

  const saveList = async () => {
    if (!selectedDirectoryId) return;
    const members = listDraft.members
      .split(",")
      .map((raw) => parseMember(raw.trim()))
      .filter((member): member is { email: string; displayName: string | null } => Boolean(member?.email));
    const saved = await saveContactList({
      id: selectedListId ?? undefined,
      directoryId: selectedDirectoryId,
      name: listDraft.name,
      nickname: listDraft.nickname || null,
      description: listDraft.description || null,
      members,
    });
    setSelectedListId(saved.id);
    setStatus("Mailing list saved.");
    await load();
  };

  const handleExport = async () => {
    if (!richContact) return;
    const vcard = await exportContactToVCard(richContact.id) ?? buildVCardForRichContact(richContact);
    downloadText(`${safeFilename(richContact.display_name ?? richContact.email)}.vcf`, vcard, "text/vcard");
    setStatus("vCard exported.");
  };

  const previewImport = () => {
    const errors: string[] = [];
    let parsed: ParsedVCardContact | null = null;
    if (importFormat !== "vcard") {
      errors.push("This import format is coming later.");
    } else if (!importText.trim()) {
      errors.push("Choose a vCard file or paste vCard text.");
    } else {
      parsed = parseVCard(importText);
      if (parsed.emails.length === 0) errors.push("vCard import requires at least one EMAIL field.");
    }
    const count = parsed && errors.length === 0 ? 1 : 0;
    setImportPreview({ parsed, count, errors });
    setImportStep(3);
  };

  const handleImport = async () => {
    const parsed = importPreview.parsed ?? parseVCard(importText);
    if (parsed.emails.length === 0) {
      setImportPreview({ parsed, count: 0, errors: ["vCard import requires at least one EMAIL field."] });
      setImportStep(3);
      return;
    }
    const parsedForm = contactFormFromParsedVCard(parsed);
    const saved = await saveRichContact({
      directoryId: importDirectoryId || selectedDirectoryId || "personal",
      displayName: parsedForm.displayName || `${parsedForm.firstName} ${parsedForm.lastName}`.trim() || parsed.emails[0] || null,
      firstName: parsedForm.firstName || null,
      lastName: parsedForm.lastName || null,
      nickname: parsedForm.nickname || null,
      notes: parsedForm.notes || null,
      organization: parsedForm.organization || null,
      title: parsedForm.title || null,
      role: parsedForm.role || null,
      timezone: parsedForm.timezone || null,
      birthday: parsedForm.birthday || null,
      anniversary: parsedForm.anniversary || null,
      identities: parsedForm.emails.map((email, index) => ({
        email: email.value,
        label: email.label,
        displayName: email.displayName,
        isPrimary: email.isPrimary === true || index === 0,
      })),
      primaryEmail: parsedForm.emails.find((email) => email.isPrimary)?.value ?? parsed.emails[0] ?? null,
      methods: [...parsedForm.phones, ...parsedForm.urls, ...parsedForm.impps],
      addresses: parsedForm.addresses,
      specialDates: parsedForm.dates,
      vcardUid: parsed.uid,
      rawVcard: importText,
      sourceType: "vcard",
    });
    setImportText("");
    setImportFileName(null);
    setImportPreview(blankImportPreview());
    setSelectedContactId(saved.id);
    setSelectedDirectoryId(saved.directory_id ?? importDirectoryId);
    setMode("view");
    setStatus("vCard imported.");
    await load();
  };

  const addDirectory = async () => {
    const id = crypto.randomUUID();
    const authRef = directoryDraft.password ? `contact_directory:${id}:password` : null;
    if (authRef) await setSecureSetting(authRef, directoryDraft.password);
    const directory = await saveContactDirectory({
      id,
      kind: directoryDraft.kind,
      name: directoryDraft.name || defaultDirectoryName(directoryDraft.kind),
      serverUrl: directoryDraft.serverUrl || null,
      username: directoryDraft.username || null,
      authRef,
      readOnly: directoryDraft.kind === "ldap",
      ldapHost: directoryDraft.ldapHost || null,
      ldapPort: Number.parseInt(directoryDraft.ldapPort, 10) || null,
      ldapSecurity: directoryDraft.ldapSecurity,
      ldapBaseDn: directoryDraft.ldapBaseDn || null,
      ldapFilter: directoryDraft.ldapFilter || null,
      ldapBindDn: directoryDraft.ldapBindDn || null,
    });
    setSelectedDirectoryId(directory.id);
    setDirectoryDraft(blankDirectoryDraft(directoryDraft.kind));
    setStatus("Address book added.");
    await load();
  };

  const runDirectoryAction = async (action: "discover" | "test" | "sync" | "ldap-search") => {
    if (action === "discover") {
      const url = await discoverCardDavUrl(directoryDraft.username || selectedDirectory?.username || "");
      setDirectoryDraft((draft) => ({ ...draft, serverUrl: url ?? draft.serverUrl }));
      setStatus(url ? `Discovered ${url}` : "No CardDAV endpoint discovered.");
      return;
    }
    if (!selectedDirectory) return;
    if (selectedDirectory.kind === "carddav" && action === "test") {
      const result = await testCardDavDirectory(selectedDirectory.id);
      setStatus(result.message);
      return;
    }
    if (selectedDirectory.kind === "carddav" && action === "sync") {
      const result = await syncCardDavDirectory(selectedDirectory.id);
      setStatus(`CardDAV sync imported ${result.imported}, skipped ${result.skipped}${result.errors.length ? `, errors: ${result.errors[0]}` : ""}.`);
      await load();
      return;
    }
    if (selectedDirectory.kind === "ldap" && action === "test") {
      const result = await testLdapDirectory(selectedDirectory.id);
      setStatus(result.message);
      return;
    }
    if (selectedDirectory.kind === "ldap" && action === "ldap-search") {
      if (!query.trim()) {
        setStatus("Type a search query first.");
        return;
      }
      const results = await searchLdapDirectory(selectedDirectory.id, query.trim());
      setLdapResults(results);
      setStatus(`LDAP returned ${results.length} result${results.length === 1 ? "" : "s"}.`);
    }
  };

  const cacheLdapResult = async (result: LdapContactResult) => {
    if (!selectedDirectoryId || !result.email) return;
    const saved = await saveRichContact({
      directoryId: selectedDirectoryId,
      displayName: result.displayName ?? result.email,
      identities: [{ email: result.email, isPrimary: true }],
      primaryEmail: result.email,
      organization: result.organization,
      title: result.title,
      sourceType: "ldap",
      remoteUid: result.dn,
      readOnly: true,
    });
    setSelectedContactId(saved.id);
    setStatus("LDAP result cached as read-only contact.");
    await load();
  };

  return (
    <div
      ref={contactsShellRef}
      className="grid h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-bg-primary/50 text-text-primary"
      style={{
        gridTemplateColumns: `${fittedColumnWidths.directories}px ${CONTACT_RESIZE_HANDLE_WIDTH}px ${fittedColumnWidths.list}px ${CONTACT_RESIZE_HANDLE_WIDTH}px minmax(0, 1fr)`,
      }}
    >
      <aside className="flex min-h-0 min-w-0 flex-col bg-bg-primary/30 backdrop-blur-sm">
        <div className="border-b border-border-primary p-3">
          <div className="mb-3 flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={16} />}
              className="flex-1"
              onClick={startNewContact}
              title="New contact"
            >
              New contact
            </Button>
            <Button iconOnly size="md" icon={<Users size={16} />} title="Add address book" onClick={() => setIsDirectoryModalOpen(true)} />
            <Button iconOnly size="md" icon={<RefreshCw size={16} />} title="Refresh" onClick={() => void load()} />
          </div>
          <h1 className="text-base font-semibold">Address Book</h1>
          <p className="text-xs text-text-tertiary">Local, CardDAV, LDAP</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 text-xs font-medium uppercase text-text-tertiary">Directories</div>
          <div className="space-y-1">
            <button
              onClick={() => selectDirectory(null)}
              className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                selectedDirectoryId === null ? "bg-accent/10 text-accent" : "hover:bg-bg-hover"
              }`}
            >
              <Users size={15} className="shrink-0" />
              <span className="flex-1 truncate">All address books</span>
              <span className="text-[0.625rem] text-text-tertiary">{contacts.length}</span>
            </button>
            {directories.map((directory) => {
              const Icon = directory.kind === "carddav" ? FolderSync : directory.kind === "ldap" ? Server : Users;
              const count = contacts.filter((contact) => contact.directory_id === directory.id).length;
              return (
                <button
                  key={directory.id}
                  onClick={() => selectDirectory(directory.id)}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                    selectedDirectoryId === directory.id ? "bg-accent/10 text-accent" : "hover:bg-bg-hover"
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="flex-1 truncate">{directory.name}</span>
                  {directory.read_only === 1 ? (
                    <span className="text-[0.625rem] text-text-tertiary">RO</span>
                  ) : (
                    <span className="text-[0.625rem] text-text-tertiary">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border-primary p-3">
          <button
            className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            onClick={startImport}
          >
            <span className="inline-flex items-center gap-2"><Import size={15} /> Import</span>
            <span className="text-xs text-text-tertiary">{contacts.length} total</span>
          </button>
        </div>
      </aside>

      <ResizeHandle label="Resize address books column" onMouseDown={(event) => startColumnResize("directories", event)} onDoubleClick={resetColumnWidths} />

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="space-y-2 border-b border-border-primary bg-bg-primary/30 p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                className="w-full rounded-md border border-border-primary bg-bg-secondary py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
                placeholder="Search contacts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button iconOnly size="md" icon={<List size={16} />} title="New mailing list" onClick={startNewList} />
          </div>
          {selectedDirectory && (
            <div className="flex gap-1">
              {selectedDirectory.kind === "carddav" && (
                <>
                  <Button size="xs" icon={<Server size={12} />} onClick={() => void runDirectoryAction("test")}>Test</Button>
                  <Button size="xs" icon={<FolderSync size={12} />} onClick={() => void runDirectoryAction("sync")}>Sync</Button>
                </>
              )}
              {selectedDirectory.kind === "ldap" && (
                <>
                  <Button size="xs" icon={<Server size={12} />} onClick={() => void runDirectoryAction("test")}>Test LDAP</Button>
                  <Button size="xs" icon={<Search size={12} />} onClick={() => void runDirectoryAction("ldap-search")}>Search LDAP</Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {selectedDirectory?.kind === "ldap" && ldapResults.map((result) => (
            <button
              key={result.dn}
              onClick={() => void cacheLdapResult(result)}
              className="mb-2 w-full rounded-md border border-border-primary bg-bg-primary px-3 py-3 text-left hover:bg-bg-hover"
              disabled={!result.email}
            >
              <div className="flex items-center gap-2">
                <Server size={14} className="text-text-tertiary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{result.displayName ?? result.email ?? result.dn}</div>
                  <div className="text-xs text-text-tertiary truncate">{result.email ?? "No email address"}</div>
                </div>
              </div>
            </button>
          ))}
          {directoryLists.map((list) => (
            <button
              key={list.id}
              onClick={() => selectList(list)}
              className={`mb-2 w-full rounded-md border px-3 py-3 text-left hover:bg-bg-hover ${
                selectedListId === list.id ? "border-accent bg-accent/10" : "border-border-primary bg-bg-primary"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users size={14} className="text-text-tertiary" />
                <span className="truncate">{list.name}</span>
              </div>
              <div className="text-xs text-text-tertiary pl-6">{list.members.length} members</div>
            </button>
          ))}
          {filteredContacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => selectContact(contact.id)}
              className={`mb-2 w-full rounded-md border px-3 py-3 text-left hover:bg-bg-hover ${
                selectedContactId === contact.id ? "border-accent bg-accent/10" : "border-border-primary bg-bg-primary"
              }`}
            >
              <div className="flex items-center gap-2">
                <ContactAvatar
                  email={contact.identities.find((identity) => identity.is_primary === 1)?.email ?? contact.email}
                  name={contact.display_name ?? contact.email}
                  avatarUrl={contact.avatar_url}
                  className="size-9 shrink-0 rounded-full border border-border-primary bg-bg-secondary"
                  textClassName="text-sm"
                  fallbackClassName="bg-bg-secondary text-text-secondary"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{contact.display_name ?? contact.email}</div>
                  <div className="text-xs text-text-tertiary truncate">{contact.identities.map((identity) => identity.email).join(", ")}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <ResizeHandle label="Resize contacts list column" onMouseDown={(event) => startColumnResize("list", event)} onDoubleClick={resetColumnWidths} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 p-4">
          {status && (
            <div className="flex items-center justify-between rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
              <span>{status}</span>
              <button className="text-text-tertiary hover:text-text-primary" onClick={() => setStatus(null)}><X size={14} /></button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {mode === "newContact" || mode === "editContact" ? (
            <InlineContactEditor
              mode={contactEditorMode}
              form={form}
              setForm={setForm}
              directories={directories}
              directoryId={contactFormDirectoryId}
              setDirectoryId={setContactFormDirectoryId}
              readOnly={contactFormReadOnly}
              onSave={() => void saveContact()}
              onCancel={() => {
                if (!confirmDiscardContactDraft()) return;
                if (richContact) setContactFormWithBaseline(formFromContact(richContact));
                setMode(richContact ? "view" : "view");
              }}
            />
          ) : mode === "import" ? (
            <ImportWizard
              step={importStep}
              setStep={setImportStep}
              format={importFormat}
              setFormat={setImportFormat}
              directories={directories}
              directoryId={importDirectoryId}
              setDirectoryId={setImportDirectoryId}
              text={importText}
              setText={(value) => {
                setImportText(value);
                setImportPreview(blankImportPreview());
              }}
              fileName={importFileName}
              setFileName={setImportFileName}
              preview={importPreview}
              onPreview={previewImport}
              onImport={() => void handleImport()}
              onCancel={() => setMode("view")}
            />
          ) : mode === "list" ? (
            <ListEditor
              draft={listDraft}
              setDraft={setListDraft}
              selectedList={selectedList}
              onSave={() => void saveList()}
              onDelete={selectedList ? async () => {
                await deleteContactList(selectedList.id);
                setSelectedListId(null);
                setMode("view");
                setStatus("Mailing list deleted.");
                await load();
              } : undefined}
            />
          ) : richContact ? (
            <ContactDetails
              contact={richContact}
              onEdit={startEditContact}
              onDelete={async () => {
                await deleteContact(richContact.id);
                setSelectedContactId(null);
                setRichContact(null);
                setStatus("Contact deleted.");
                await load();
              }}
              onExport={() => void handleExport()}
            />
          ) : (
            <div className="flex h-full items-start justify-center pt-12">
              <div className="max-w-xl text-center">
                <div>
                  <h2 className="text-xl font-semibold">{selectedDirectory?.name ?? "Address Book"}</h2>
                  <p className="mt-2 text-sm text-text-tertiary">Select a contact to see its details.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DirectoryModal
          isOpen={isDirectoryModalOpen}
          draft={directoryDraft}
          setDraft={setDirectoryDraft}
          onClose={() => setIsDirectoryModalOpen(false)}
          onDiscover={() => void runDirectoryAction("discover")}
          onSave={async () => {
            await addDirectory();
            setIsDirectoryModalOpen(false);
          }}
        />

      </main>
    </div>
  );
}

function ResizeHandle({
  label,
  onMouseDown,
  onDoubleClick,
}: {
  label: string;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      tabIndex={0}
      className="group h-full cursor-col-resize border-x border-border-primary bg-bg-secondary/60 outline-none hover:bg-accent/20 focus:bg-accent/20"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <div className="mx-auto h-full w-px bg-transparent group-hover:bg-accent/50 group-focus:bg-accent/50" />
    </div>
  );
}

function DirectoryModal({
  isOpen,
  draft,
  setDraft,
  onClose,
  onDiscover,
  onSave,
}: {
  isOpen: boolean;
  draft: ContactDirectoryDraft;
  setDraft: Dispatch<SetStateAction<ContactDirectoryDraft>>;
  onClose: () => void;
  onDiscover: () => void;
  onSave: () => void;
}) {
  const setKind = (kind: ContactDirectoryKind) => {
    setDraft((current) => current.kind === kind ? current : blankDirectoryDraft(kind));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add address book"
      width="w-[min(42rem,calc(100vw-3rem))]"
      panelClassName="max-h-[calc(100vh-3rem)] overflow-hidden"
    >
      <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-5">
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            { kind: "local" as const, label: "Local", description: "Stored on this device", icon: Users },
            { kind: "carddav" as const, label: "CardDAV", description: "Remote address book", icon: FolderSync },
            { kind: "ldap" as const, label: "LDAP", description: "Read-only directory", icon: Server },
          ]).map(({ kind, label, description, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKind(kind)}
              className={`rounded-md border p-3 text-left transition-colors ${
                draft.kind === kind ? "border-accent bg-accent/10" : "border-border-primary bg-bg-secondary hover:bg-bg-hover"
              }`}
            >
              <Icon size={18} className="mb-2 text-text-secondary" />
              <div className="text-sm font-semibold">{label}</div>
              <div className="mt-1 text-xs text-text-tertiary">{description}</div>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <TextInput label="Name" value={draft.name} placeholder={defaultDirectoryName(draft.kind)} onChange={(name) => setDraft((current) => ({ ...current, name }))} />
          {draft.kind === "carddav" && (
            <>
              <TextInput label="CardDAV URL" value={draft.serverUrl} onChange={(serverUrl) => setDraft((current) => ({ ...current, serverUrl }))} />
              <TextInput label="Username or email" value={draft.username} onChange={(username) => setDraft((current) => ({ ...current, username }))} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-tertiary">App password</span>
                <input className={FIELD_CLASS} type="password" value={draft.password} onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))} />
              </label>
              <Button size="xs" icon={<Globe size={12} />} onClick={onDiscover}>Discover</Button>
            </>
          )}
          {draft.kind === "ldap" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <TextInput label="LDAP host" value={draft.ldapHost} onChange={(ldapHost) => setDraft((current) => ({ ...current, ldapHost }))} />
              <TextInput label="Port" value={draft.ldapPort} onChange={(ldapPort) => setDraft((current) => ({ ...current, ldapPort }))} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-tertiary">Security</span>
                <select className={SELECT_CLASS} value={draft.ldapSecurity} onChange={(e) => setDraft((current) => ({ ...current, ldapSecurity: e.target.value }))}>
                  <option value="plain">Plain</option>
                  <option value="starttls">StartTLS</option>
                  <option value="ldaps">LDAPS</option>
                </select>
              </label>
              <TextInput label="Base DN" value={draft.ldapBaseDn} onChange={(ldapBaseDn) => setDraft((current) => ({ ...current, ldapBaseDn }))} />
              <TextInput label="Search filter" value={draft.ldapFilter} onChange={(ldapFilter) => setDraft((current) => ({ ...current, ldapFilter }))} />
              <TextInput label="Bind DN" value={draft.ldapBindDn} onChange={(ldapBindDn) => setDraft((current) => ({ ...current, ldapBindDn }))} />
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs font-medium text-text-tertiary">Bind password</span>
                <input className={FIELD_CLASS} type="password" value={draft.password} onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))} />
              </label>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-border-primary pt-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={onSave}>Add address book</Button>
        </div>
      </div>
    </Modal>
  );
}

function ContactDetails({
  contact,
  onEdit,
  onDelete,
  onExport,
}: {
  contact: RichContact;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const grouped = {
    emails: contact.methods.filter((method) => method.kind === "email"),
    phones: contact.methods.filter((method) => method.kind === "phone"),
    urls: contact.methods.filter((method) => method.kind === "url"),
    impps: contact.methods.filter((method) => method.kind === "impp"),
  };
  const addresses = contact.addresses
    .map((address) => ({
      label: address.label ?? "address",
      value: [address.street, address.city, address.region, address.postal_code, address.country].filter(Boolean).join(", "),
    }))
    .filter((address) => address.value);
  const organizationRows = [
    { label: "Organization", value: contact.organization },
    { label: "Title", value: contact.title },
    { label: "Role", value: contact.role },
    { label: "Timezone", value: contact.timezone },
  ].filter((row) => row.value);
  const nameRows = [
    { label: "First name", value: contact.first_name },
    { label: "Last name", value: contact.last_name },
    { label: "Nickname", value: contact.nickname },
  ];
  const dateRows = [
    { label: "Birthday", value: contact.birthday },
    { label: "Anniversary", value: contact.anniversary },
    ...contact.specialDates
      .filter((date) => date.kind !== "birthday" && date.kind !== "anniversary")
      .map((date) => ({ label: date.label ?? date.kind, value: date.value })),
  ];
  const primaryEmail = contact.identities.find((identity) => identity.is_primary === 1)?.email ?? contact.email;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-start gap-5">
        <ContactAvatar
          email={primaryEmail}
          name={contact.display_name ?? contact.email}
          avatarUrl={contact.avatar_url}
          className="size-24 shrink-0 rounded-full bg-bg-secondary text-text-primary"
          textClassName="text-4xl"
          fallbackClassName="bg-bg-secondary text-text-primary"
        />
        <div className="min-w-0 flex-1 pt-2">
          <h2 className="break-words text-3xl font-semibold leading-tight">{contact.display_name ?? contact.email}</h2>
          <p className="mt-1 break-all text-base text-text-tertiary">{primaryEmail}</p>
          <p className="mt-1 text-sm text-text-tertiary">{contact.directory?.name ?? "Contact card"}</p>
        </div>
      </div>

      <section className="rounded-md border border-border-primary bg-bg-secondary p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<Download size={15} />} onClick={onExport}>Export</Button>
          <Button variant="primary" icon={<Save size={15} />} onClick={onEdit} disabled={contact.read_only === 1}>Edit</Button>
          <Button variant="ghost" icon={<Trash2 size={15} />} onClick={onDelete} disabled={contact.read_only === 1}>Delete</Button>
        </div>
      </section>

      <div className="space-y-4">
        <DetailSection title="Name" rows={nameRows} />
        <DetailSection title="Email addresses" rows={grouped.emails.map((method) => ({ label: method.label ?? "email", value: method.value }))} />
        <DetailSection title="Phones" rows={grouped.phones.map((method) => ({ label: method.label ?? "phone", value: method.value }))} />
        <DetailSection title="Websites" rows={grouped.urls.map((method) => ({ label: method.label ?? "url", value: method.value }))} />
        <DetailSection title="Chat" rows={grouped.impps.map((method) => ({ label: method.label ?? "impp", value: method.value }))} />
        <DetailSection title="Addresses" rows={addresses} />
        <DetailSection title="Organization" rows={organizationRows} />
        <DetailSection title="Dates" rows={dateRows} />
        {contact.notes && (
          <section className="rounded-md border border-border-primary bg-bg-secondary p-4">
            <h3 className="mb-3 text-sm font-semibold">Notes</h3>
            <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">{contact.notes}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function DetailSection({ title, rows }: { title: string; rows: Array<{ label: string; value?: string | null }> }) {
  const visibleRows = rows.filter((row) => row.value);
  if (visibleRows.length === 0) return null;
  return (
    <section className="rounded-md border border-border-primary bg-bg-secondary p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">
        {visibleRows.map((row, index) => (
          <div key={`${row.label}-${index}`} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 text-sm">
            <span className="text-text-tertiary">{row.label}</span>
            <span className="min-w-0 break-all text-text-primary">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InlineContactEditor({
  mode,
  form,
  setForm,
  directories,
  directoryId,
  setDirectoryId,
  readOnly,
  onSave,
  onCancel,
}: {
  mode: ContactEditorMode;
  form: ContactFormState;
  setForm: Dispatch<SetStateAction<ContactFormState>>;
  directories: ContactDirectory[];
  directoryId: string;
  setDirectoryId: Dispatch<SetStateAction<string>>;
  readOnly: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{mode === "edit" ? "Edit contact" : "New contact"}</h2>
        </div>
      </div>
      <ContactForm
        form={form}
        setForm={setForm}
        directories={directories}
        directoryId={directoryId}
        setDirectoryId={setDirectoryId}
        readOnly={readOnly}
        submitLabel={mode === "edit" ? "Save" : "Create contact"}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}

function ImportWizard({
  step,
  setStep,
  format,
  setFormat,
  directories,
  directoryId,
  setDirectoryId,
  text,
  setText,
  fileName,
  setFileName,
  preview,
  onPreview,
  onImport,
  onCancel,
}: {
  step: ImportStep;
  setStep: Dispatch<SetStateAction<ImportStep>>;
  format: ImportFormat;
  setFormat: Dispatch<SetStateAction<ImportFormat>>;
  directories: ContactDirectory[];
  directoryId: string;
  setDirectoryId: Dispatch<SetStateAction<string>>;
  text: string;
  setText: (value: string) => void;
  fileName: string | null;
  setFileName: Dispatch<SetStateAction<string | null>>;
  preview: ImportPreview;
  onPreview: () => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  const selectedFormat = importFormats.find((item) => item.id === format);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Import contacts</h2>
        </div>
        <Button icon={<X size={14} />} onClick={onCancel}>Close</Button>
      </div>

      <div className="flex gap-2 text-xs text-text-tertiary">
        {([1, 2, 3] as const).map((item) => (
          <span key={item} className={`rounded-full border px-3 py-1 ${step === item ? "border-accent text-accent" : "border-border-primary"}`}>
            Step {item}
          </span>
        ))}
      </div>

      {step === 1 && (
        <section className="rounded-md border border-border-primary bg-bg-secondary p-4">
          <h3 className="mb-3 text-sm font-semibold">Choose format</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {importFormats.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!item.enabled}
                onClick={() => setFormat(item.id)}
                className={`rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                  format === item.id ? "border-accent bg-accent/10" : "border-border-primary bg-bg-primary hover:bg-bg-hover"
                }`}
              >
                <div className="text-sm font-semibold">{item.label}</div>
                <div className="mt-1 text-xs text-text-tertiary">{item.description}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => setStep(2)} disabled={!selectedFormat?.enabled}>Next</Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4 rounded-md border border-border-primary bg-bg-secondary p-4">
          <div>
            <h3 className="text-sm font-semibold">vCard source</h3>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-tertiary">Target address book</span>
            <select className={SELECT_CLASS} value={directoryId} onChange={(event) => setDirectoryId(event.target.value)}>
              {directories.map((directory) => (
                <option key={directory.id} value={directory.id} disabled={directory.read_only === 1}>
                  {directory.name}{directory.read_only === 1 ? " (read-only)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-tertiary">vCard file</span>
            <input
              className={FIELD_CLASS}
              type="file"
              accept=".vcf,text/vcard,text/x-vcard"
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setText(await file.text());
              }}
            />
            {fileName && <span className="mt-1 block text-xs text-text-tertiary">{fileName}</span>}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-tertiary">Paste vCard text</span>
            <textarea
              value={text}
              onChange={(event) => {
                setFileName(null);
                setText(event.target.value);
              }}
              placeholder="BEGIN:VCARD..."
              className="min-h-56 w-full rounded border border-border-primary bg-bg-primary p-2 text-xs font-mono outline-none focus:border-accent"
            />
          </label>
          <div className="flex justify-between gap-2">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" onClick={onPreview} disabled={!text.trim()}>Preview</Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4 rounded-md border border-border-primary bg-bg-secondary p-4">
          <div>
            <h3 className="text-sm font-semibold">Preview</h3>
            <p className="mt-1 text-xs text-text-tertiary">
              {preview.errors.length > 0 ? `${preview.errors.length} issue${preview.errors.length === 1 ? "" : "s"} found.` : `${preview.count} contact${preview.count === 1 ? "" : "s"} ready to import.`}
            </p>
          </div>
          {preview.errors.length > 0 ? (
            <div className="space-y-2">
              {preview.errors.map((error) => (
                <div key={error} className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-text-primary">{error}</div>
              ))}
            </div>
          ) : preview.parsed ? (
            <div className="rounded-md border border-border-primary bg-bg-primary p-3 text-sm">
              <div className="font-medium">{preview.parsed.displayName ?? preview.parsed.emails[0]}</div>
              <div className="mt-1 break-all text-xs text-text-tertiary">{preview.parsed.emails.join(", ")}</div>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button variant="primary" icon={<Upload size={14} />} onClick={onImport} disabled={preview.errors.length > 0 || !preview.parsed}>
              Import
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ContactForm({
  form,
  setForm,
  directories,
  directoryId,
  setDirectoryId,
  readOnly,
  submitLabel,
  onSave,
  onCancel,
}: {
  form: ContactFormState;
  setForm: Dispatch<SetStateAction<ContactFormState>>;
  directories: ContactDirectory[];
  directoryId: string;
  setDirectoryId: Dispatch<SetStateAction<string>>;
  readOnly: boolean;
  submitLabel: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [photoError, setPhotoError] = useState<string | null>(null);
  const update = (field: keyof ContactFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const previewAvatarUrl = form.avatarDataUrl ?? (form.avatarRemoved ? null : form.avatarUrl.trim() || null);
  const previewEmail = form.emails.find((email) => email.isPrimary)?.value || form.emails[0]?.value || null;

  const handleAvatarFile = async (file: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await prepareContactAvatarFile(file);
      setPhotoError(null);
      setForm((current) => ({
        ...current,
        avatarDataUrl: dataUrl,
        avatarRemoved: false,
      }));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not read contact photo.");
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-border-primary bg-bg-secondary p-4">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-4">
          <ContactAvatar
            email={previewEmail}
            name={form.displayName || `${form.firstName} ${form.lastName}`.trim() || previewEmail}
            avatarUrl={previewAvatarUrl}
            className="size-20 shrink-0 rounded-full border border-border-primary bg-bg-primary"
            textClassName="text-2xl"
            fallbackClassName="bg-bg-primary text-text-secondary"
          />
          <div className="min-w-0 space-y-3">
            <div className="min-w-0">
              <label htmlFor="contact-photo-url" className="mb-1 block whitespace-nowrap text-xs font-medium text-text-tertiary">
                Photo URL
              </label>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem_2.25rem] gap-2">
                <input
                  id="contact-photo-url"
                  className={FIELD_CLASS}
                  value={form.avatarDataUrl ? "" : form.avatarUrl}
                  placeholder="https://example.com/photo.jpg"
                  disabled={readOnly}
                  onChange={(event) => {
                    setPhotoError(null);
                    setForm((current) => ({
                      ...current,
                      avatarUrl: event.target.value,
                      avatarDataUrl: null,
                      avatarRemoved: false,
                    }));
                  }}
                />
                <label className="block self-end">
                  <span className="sr-only">Upload contact photo</span>
                  <input
                    className="sr-only"
                    type="file"
                    aria-label="Upload contact photo"
                    accept="image/*"
                    disabled={readOnly}
                    onChange={(event) => void handleAvatarFile(event.currentTarget.files?.[0] ?? null)}
                  />
                  <span
                    className={`inline-flex size-9 items-center justify-center rounded-md border border-border-primary text-text-secondary transition-colors ${
                      readOnly ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-bg-hover"
                    }`}
                    title="Upload contact photo"
                  >
                    <Upload size={14} />
                  </span>
                </label>
                <Button
                  type="button"
                  size="md"
                  iconOnly
                  aria-label="Remove contact photo"
                  title="Remove contact photo"
                  className="size-9 border border-border-primary text-text-secondary"
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    setPhotoError(null);
                    setForm((current) => ({
                      ...current,
                      avatarUrl: "",
                      avatarDataUrl: null,
                      avatarRemoved: true,
                    }));
                  }}
                  disabled={readOnly || (!form.avatarUrl && !form.avatarDataUrl && !form.avatarRemoved)}
                />
              </div>
            </div>
            {photoError && <p className="text-xs text-danger">{photoError}</p>}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <label className="block min-w-0">
          <span className="mb-1 block whitespace-nowrap text-xs font-medium text-text-tertiary">Address book</span>
          <select className={SELECT_CLASS} value={directoryId} onChange={(e) => setDirectoryId(e.target.value)}>
            {directories.map((directory) => (
              <option key={directory.id} value={directory.id} disabled={directory.read_only === 1}>
                {directory.name}{directory.read_only === 1 ? " (read-only)" : ""}
              </option>
            ))}
          </select>
        </label>
        {readOnly && (
          <div className="rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-xs text-text-tertiary">
            This address book is read-only.
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TextInput label="Display name" value={form.displayName} onChange={(v) => update("displayName", v)} />
        <TextInput label="Nickname" value={form.nickname} onChange={(v) => update("nickname", v)} />
        <TextInput label="First name" value={form.firstName} onChange={(v) => update("firstName", v)} />
        <TextInput label="Last name" value={form.lastName} onChange={(v) => update("lastName", v)} />
        <TextInput label="Organization" value={form.organization} onChange={(v) => update("organization", v)} />
        <TextInput label="Title" value={form.title} onChange={(v) => update("title", v)} />
        <TextInput label="Role" value={form.role} onChange={(v) => update("role", v)} />
        <TextInput label="Timezone" value={form.timezone} onChange={(v) => update("timezone", v)} />
        <TextInput label="Birthday" value={form.birthday} onChange={(v) => update("birthday", v)} placeholder="YYYY-MM-DD" />
        <TextInput label="Anniversary" value={form.anniversary} onChange={(v) => update("anniversary", v)} placeholder="YYYY-MM-DD" />
      </section>

      <MethodEditor title="Emails" kind="email" items={form.emails} setItems={(updater) => setForm((current) => ({ ...current, emails: applyListUpdate(current.emails, updater) }))} />
      <MethodEditor title="Phones" kind="phone" items={form.phones} setItems={(updater) => setForm((current) => ({ ...current, phones: applyListUpdate(current.phones, updater) }))} />
      <MethodEditor title="Websites" kind="url" items={form.urls} setItems={(updater) => setForm((current) => ({ ...current, urls: applyListUpdate(current.urls, updater) }))} />
      <MethodEditor title="Chat / IMPP" kind="impp" items={form.impps} setItems={(updater) => setForm((current) => ({ ...current, impps: applyListUpdate(current.impps, updater) }))} />
      <AddressEditor items={form.addresses} setItems={(updater) => setForm((current) => ({ ...current, addresses: applyListUpdate(current.addresses, updater) }))} />
      <SpecialDatesEditor items={form.dates} setItems={(updater) => setForm((current) => ({ ...current, dates: applyListUpdate(current.dates, updater) }))} />

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-tertiary">Notes</span>
        <textarea className="w-full min-h-28 rounded border border-border-primary bg-bg-secondary p-2 text-sm outline-none focus:border-accent" value={form.notes} onChange={(e) => update("notes", e.target.value)} />
      </label>

      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border-primary bg-bg-primary/95 px-5 py-4">
        <Button icon={<X size={14} />} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" icon={<Save size={14} />} onClick={onSave} disabled={readOnly}>{submitLabel}</Button>
      </div>
    </div>
  );
}

function applyListUpdate<T>(items: T[], updater: SetStateAction<T[]>): T[] {
  return typeof updater === "function" ? updater(items) : updater;
}

function MethodEditor({
  title,
  kind,
  items,
  setItems,
}: {
  title: string;
  kind: ContactMethodInput["kind"];
  items: ContactMethodInput[];
  setItems: Dispatch<SetStateAction<ContactMethodInput[]>>;
}) {
  return (
    <section className="rounded-md border border-border-primary bg-bg-secondary p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button type="button" size="xs" icon={<Plus size={12} />} onClick={() => setItems((current) => [...current, { kind, value: "", label: "", isPrimary: current.length === 0 }])}>Add</Button>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[100px_1fr_auto_auto] gap-2">
            <input className={FIELD_CLASS} placeholder="Label" value={item.label ?? ""} onChange={(e) => setItems((currentItems) => currentItems.map((current, i) => i === index ? { ...current, label: e.target.value } : current))} />
            <input className={FIELD_CLASS} placeholder={kind} value={item.value} onChange={(e) => setItems((currentItems) => currentItems.map((current, i) => i === index ? { ...current, value: e.target.value } : current))} />
            <button type="button" className={`px-2 text-xs rounded border ${item.isPrimary ? "border-accent text-accent" : "border-border-primary text-text-tertiary"}`} onClick={() => setItems((currentItems) => currentItems.map((current, i) => ({ ...current, isPrimary: i === index })))}>Primary</button>
            <Button type="button" iconOnly size="xs" icon={<Trash2 size={12} />} title={`Remove ${kind}`} onClick={() => setItems((currentItems) => currentItems.filter((_, i) => i !== index))} />
          </div>
        ))}
      </div>
    </section>
  );
}

function AddressEditor({ items, setItems }: { items: ContactAddressInput[]; setItems: Dispatch<SetStateAction<ContactAddressInput[]>> }) {
  return (
    <section className="rounded-md border border-border-primary bg-bg-secondary p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Postal addresses</h3>
        <Button type="button" size="xs" icon={<Plus size={12} />} onClick={() => setItems((current) => [...current, { label: "", street: "", city: "", region: "", postalCode: "", country: "" }])}>Add</Button>
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-2 gap-2">
            {(["label", "street", "city", "region", "postalCode", "country"] as const).map((field) => (
              <input key={field} className={FIELD_CLASS} placeholder={field} value={item[field] ?? ""} onChange={(e) => setItems((currentItems) => currentItems.map((current, i) => i === index ? { ...current, [field]: e.target.value } : current))} />
            ))}
            <Button type="button" size="xs" icon={<Trash2 size={12} />} onClick={() => setItems((currentItems) => currentItems.filter((_, i) => i !== index))}>Remove</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SpecialDatesEditor({ items, setItems }: { items: ContactSpecialDateInput[]; setItems: Dispatch<SetStateAction<ContactSpecialDateInput[]>> }) {
  return (
    <section className="rounded-md border border-border-primary bg-bg-secondary p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Special dates</h3>
        <Button type="button" size="xs" icon={<Plus size={12} />} onClick={() => setItems((current) => [...current, { kind: "custom", label: "", value: "" }])}>Add</Button>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[120px_1fr_1fr_auto] gap-2">
            <select className={FIELD_CLASS} value={item.kind} onChange={(e) => setItems((currentItems) => currentItems.map((current, i) => i === index ? { ...current, kind: e.target.value } : current))}>
              <option value="custom">Custom</option>
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
            </select>
            <input className={FIELD_CLASS} placeholder="Label" value={item.label ?? ""} onChange={(e) => setItems((currentItems) => currentItems.map((current, i) => i === index ? { ...current, label: e.target.value } : current))} />
            <input className={FIELD_CLASS} placeholder="YYYY-MM-DD" value={item.value} onChange={(e) => setItems((currentItems) => currentItems.map((current, i) => i === index ? { ...current, value: e.target.value } : current))} />
            <Button type="button" iconOnly size="xs" icon={<Trash2 size={12} />} title="Remove date" onClick={() => setItems((currentItems) => currentItems.filter((_, i) => i !== index))} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ListEditor({
  draft,
  setDraft,
  selectedList,
  onSave,
  onDelete,
}: {
  draft: { name: string; nickname: string; description: string; members: string };
  setDraft: Dispatch<SetStateAction<{ name: string; nickname: string; description: string; members: string }>>;
  selectedList: ContactListWithMembers | null;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{selectedList ? "Edit mailing list" : "New mailing list"}</h2>
        <div className="flex gap-2">
          {onDelete && <Button icon={<Trash2 size={14} />} onClick={onDelete}>Delete</Button>}
          <Button variant="primary" icon={<Save size={14} />} onClick={onSave}>Save list</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextInput label="Name" value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
        <TextInput label="Nickname" value={draft.nickname} onChange={(value) => setDraft((current) => ({ ...current, nickname: value }))} />
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-tertiary">Description</span>
        <input className={FIELD_CLASS} value={draft.description} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-tertiary">Members</span>
        <textarea className="w-full min-h-32 rounded border border-border-primary bg-bg-secondary p-2 text-sm outline-none focus:border-accent" placeholder="alice@example.com, Bob <bob@example.com>" value={draft.members} onChange={(e) => setDraft((current) => ({ ...current, members: e.target.value }))} />
      </label>
    </div>
  );
}

function TextInput({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-tertiary">{label}</span>
      <input className={FIELD_CLASS} placeholder={placeholder} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function parseMember(raw: string): { email: string; displayName: string | null } | null {
  const match = raw.match(/^(.*?)<([^>]+)>$/);
  if (match) return { displayName: match[1]?.trim() || null, email: match[2]!.trim() };
  if (raw.includes("@")) return { displayName: null, email: raw };
  return null;
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "contact";
}

function defaultDirectoryName(kind: ContactDirectoryKind): string {
  if (kind === "carddav") return "CardDAV Address Book";
  if (kind === "ldap") return "LDAP Directory";
  if (kind === "collected") return "Collected Addresses";
  return "Local Address Book";
}
