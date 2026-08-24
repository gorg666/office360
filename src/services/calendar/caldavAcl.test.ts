import { describe, expect, it, vi } from "vitest";
import type { DAVClient } from "tsdav";
import { discoverDavAcl, grantDavShare, revokeDavShare, updateDavShare } from "./caldavAcl";

const calendarUrl = "https://dav.example.test/calendars/owner/work/";
const principalUrl = "https://dav.example.test/principals/owner/";

function options(supported = true): Response {
  return new Response("", {
    status: 200,
    headers: {
      DAV: supported ? "1, 3, access-control, calendar-access" : "1, calendar-access",
      Allow: supported ? "OPTIONS, PROPFIND, REPORT, ACL" : "OPTIONS, PROPFIND, REPORT",
    },
  });
}

function aclXml(write = true): string {
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:response><D:href>${calendarUrl}</D:href><D:propstat><D:prop>
      <D:owner><D:href>${principalUrl}</D:href></D:owner>
      <D:current-user-privilege-set>
        <D:privilege><D:read-acl/></D:privilege>
        ${write ? "<D:privilege><D:write-acl/></D:privilege>" : ""}
      </D:current-user-privilege-set>
      <D:supported-privilege-set/>
      <D:principal-collection-set><D:href>/principals/</D:href></D:principal-collection-set>
      <D:acl>
        <D:ace><D:principal><D:href>${principalUrl}</D:href></D:principal>
          <D:grant><D:privilege><D:read/></D:privilege><D:privilege><D:write/></D:privilege></D:grant><D:protected/>
        </D:ace>
        <D:ace><D:principal><D:href>/principals/guest/</D:href></D:principal>
          <D:grant><D:privilege><C:read-free-busy/></D:privilege></D:grant>
        </D:ace>
      </D:acl>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
  </D:multistatus>`;
}

function client(responses: Response[]) {
  const fetchOverride = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
  return { client: { fetchOverride, authHeaders: { Authorization: "redacted" } } as unknown as DAVClient, fetchOverride };
}

describe("RFC 3744 CalDAV ACL", () => {
  it("discovers and lists a complete supported ACL contract", async () => {
    const mock = client([options(), new Response(aclXml(), { status: 207 })]);
    const result = await discoverDavAcl(mock.client, calendarUrl, principalUrl);
    expect(result.capabilities).toEqual({ read: "supported", write: "supported", reason: null });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ role: "owner", isCurrentUser: true, isProtected: true });
    expect(result.entries[1]).toMatchObject({ role: "free-busy-only", isProtected: false });
  });

  it("keeps Yandex-like effective-permission-only DAV responses unsupported", async () => {
    const mock = client([options(false), new Response(aclXml(false), { status: 207 })]);
    const result = await discoverDavAcl(mock.client, calendarUrl, principalUrl);
    expect(result.capabilities.write).toBe("unsupported");
    expect(result.capabilities.reason).toBe("write-acl-contract-incomplete");
  });

  it("resolves a principal and sends full ACL for grant/update/revoke", async () => {
    const principalSearch = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      <D:response><D:href>/principals/new/</D:href><D:propstat><D:prop>
        <C:calendar-user-address-set><D:href>mailto:new@example.com</D:href></C:calendar-user-address-set>
      </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
    const grant = client([
      options(), new Response(aclXml(), { status: 207 }),
      new Response(principalSearch, { status: 207 }), new Response("", { status: 200 }),
    ]);
    await expect(grantDavShare(grant.client, calendarUrl, principalUrl, "new@example.com", "reader"))
      .resolves.toMatchObject({ role: "reader", principalValue: "new@example.com" });
    expect(grant.fetchOverride.mock.calls[3]![1]).toMatchObject({ method: "ACL" });
    expect(String(grant.fetchOverride.mock.calls[3]![1].body)).toContain("/principals/new/");

    const guestId = `dav:${encodeURIComponent("https://dav.example.test/principals/guest/")}`;
    const update = client([options(), new Response(aclXml(), { status: 207 }), new Response("", { status: 200 })]);
    await expect(updateDavShare(update.client, calendarUrl, principalUrl, guestId, "writer"))
      .resolves.toMatchObject({ role: "writer" });
    expect(String(update.fetchOverride.mock.calls[2]![1].body)).toContain("<D:write/>");

    const revoke = client([options(), new Response(aclXml(), { status: 207 }), new Response("", { status: 200 })]);
    await revokeDavShare(revoke.client, calendarUrl, principalUrl, guestId);
    expect(String(revoke.fetchOverride.mock.calls[2]![1].body)).not.toContain("principals/guest");
  });

  it("refuses to change protected owner/current-user ACEs", async () => {
    const ownerId = `dav:${encodeURIComponent(principalUrl)}`;
    const mock = client([options(), new Response(aclXml(), { status: 207 })]);
    await expect(revokeDavShare(mock.client, calendarUrl, principalUrl, ownerId))
      .rejects.toMatchObject({ code: "owner-protected" });
    expect(mock.fetchOverride).toHaveBeenCalledTimes(2);
  });
});
