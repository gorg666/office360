import {
  CALDAV_CAPABILITIES,
  EXCHANGE_CAPABILITIES,
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

  it("supports IMAP folder operations and marks native labels unsupported", () => {
    expect(IMAP_CAPABILITIES.folders.create.supported).toBe(true);
    expect(IMAP_CAPABILITIES.folders.rename.supported).toBe(true);
    expect(IMAP_CAPABILITIES.folders.delete.supported).toBe(true);
    expect(IMAP_CAPABILITIES.folders.subscribe.supported).toBe(true);
    expect(IMAP_CAPABILITIES.folders.quota.supported).toBe(true);
    expect(IMAP_CAPABILITIES.labels.add.supported).toBe(false);
    expect(IMAP_CAPABILITIES.labels.add.reason).toContain("native labels");
  });

  it("marks CalDAV mail capabilities unsupported", () => {
    expect(CALDAV_CAPABILITIES.messages.archive.supported).toBe(false);
    expect(CALDAV_CAPABILITIES.messages.archive.reason).toContain("calendar-only");
  });

  it("marks native Exchange/Graph capabilities unsupported until an adapter exists", () => {
    expect(EXCHANGE_CAPABILITIES.messages.rawFetch.supported).toBe(false);
    expect(EXCHANGE_CAPABILITIES.compose.send.supported).toBe(false);
    expect(EXCHANGE_CAPABILITIES.diagnostics.testIncoming.supported).toBe(false);
    expect(EXCHANGE_CAPABILITIES.messages.rawFetch.reason).toContain("Native Exchange/Graph support is planned");
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

  it("does not let future exchange accounts fall back to IMAP capabilities", () => {
    expect(getCapabilitiesForAccountProvider("exchange").provider).toBe("exchange");
    expect(getCapabilitiesForAccountProvider("exchange").folders.list.supported).toBe(false);
  });
});
