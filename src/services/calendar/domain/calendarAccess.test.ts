import { describe, expect, it } from "vitest";
import {
  collectDavPrivilegeNames,
  davCalendarAccess,
  googleCalendarAccess,
  parseCalendarAccess,
  serializeCalendarAccess,
  unknownCalendarAccess,
} from "./calendarAccess";

describe("calendar access domain", () => {
  it.each([
    ["owner", "owner", true],
    ["writer", "editor", true],
    ["writerWithoutPrivateAccess", "contributor", true],
    ["reader", "viewer", false],
    ["freeBusyReader", "free-busy-only", false],
    ["futureRole", "unknown", false],
  ])("normalizes Google role %s", (providerRole, role, writable) => {
    const access = googleCalendarAccess(providerRole);
    expect(access.role).toBe(role);
    expect(access.permissions.canCreate).toBe(writable);
    expect(access.permissions.canSeeEventDetails).toBe(role !== "free-busy-only");
  });

  it("derives independent CalDAV permissions and ownership from DAV privileges", () => {
    const privileges = collectDavPrivilegeNames({ privilege: [{ read: {} }, { bind: {} }, { writeContent: {} }, { unbind: {} }] });
    const access = davCalendarAccess({
      privileges,
      ownerHref: "https://dav.example/principals/users/me/",
      currentPrincipalHref: "https://dav.example/principals/users/me/",
    });
    expect(access).toMatchObject({
      role: "owner",
      ownership: "owned",
      permissions: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
    });
  });

  it("keeps free-busy-only calendars opaque", () => {
    const access = davCalendarAccess({ privileges: ["read-free-busy"] });
    expect(access).toMatchObject({
      role: "free-busy-only",
      permissions: { canRead: false, canSeeEventDetails: false, canSeeFreeBusy: true },
    });
  });

  it("keeps legacy unknown metadata readable but non-writable", () => {
    expect(parseCalendarAccess(null)).toEqual(unknownCalendarAccess());
    expect(parseCalendarAccess(null).permissions).toMatchObject({
      canRead: true, canSeeEventDetails: true, canCreate: false, canUpdate: false, canDelete: false,
    });
  });

  it("round-trips a versioned access envelope and rejects malformed data", () => {
    const access = googleCalendarAccess("reader");
    expect(parseCalendarAccess(serializeCalendarAccess(access))).toEqual(access);
    expect(parseCalendarAccess("not-json")).toEqual(unknownCalendarAccess());
  });
});
