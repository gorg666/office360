import {
  CALDAV_CAPABILITIES,
  GMAIL_CAPABILITIES,
  IMAP_CAPABILITIES,
  getCapabilitiesForAccountProvider,
} from "./providerCapabilities";

describe("providerCapabilities", () => {
  it("supports Gmail label CRUD", () => {
    expect(GMAIL_CAPABILITIES.labels.create.supported).toBe(true);
    expect(GMAIL_CAPABILITIES.labels.rename.supported).toBe(true);
    expect(GMAIL_CAPABILITIES.labels.delete.supported).toBe(true);
    expect(GMAIL_CAPABILITIES.labels.add.supported).toBe(true);
    expect(GMAIL_CAPABILITIES.labels.remove.supported).toBe(true);
  });

  it("marks IMAP folder CRUD and native labels unsupported with reasons", () => {
    expect(IMAP_CAPABILITIES.folders.create.supported).toBe(false);
    expect(IMAP_CAPABILITIES.folders.create.reason).toContain("not implemented");
    expect(IMAP_CAPABILITIES.labels.add.supported).toBe(false);
    expect(IMAP_CAPABILITIES.labels.add.reason).toContain("native labels");
  });

  it("marks CalDAV mail capabilities unsupported", () => {
    expect(CALDAV_CAPABILITIES.messages.archive.supported).toBe(false);
    expect(CALDAV_CAPABILITIES.messages.archive.reason).toContain("calendar-only");
  });

  it("uses Gmail capabilities only for explicit gmail_api accounts", () => {
    expect(getCapabilitiesForAccountProvider("gmail_api").provider).toBe("gmail_api");
  });

  it("defaults unknown and empty provider values to non-Gmail mail capabilities", () => {
    expect(getCapabilitiesForAccountProvider("legacy").provider).toBe("imap");
    expect(getCapabilitiesForAccountProvider("imap").provider).toBe("imap");
    expect(getCapabilitiesForAccountProvider("imap_smtp").provider).toBe("imap");
    expect(getCapabilitiesForAccountProvider("pop3").provider).toBe("imap");
    expect(getCapabilitiesForAccountProvider("yandex").provider).toBe("imap");
    expect(getCapabilitiesForAccountProvider("yandex_oauth").provider).toBe("imap");
    expect(getCapabilitiesForAccountProvider(null).provider).toBe("imap");
  });
});
