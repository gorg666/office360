import { describe, expect, it } from "vitest";
import { createMockDbAccount } from "@/test/mocks";
import { createConnectionDiagnostic } from "@/services/diagnostics";
import {
  buildYandex360WorkAccountStatuses,
  missingYandexScopes,
  parseYandexOAuthScopes,
} from "./workAccount";

const yandexAccount = createMockDbAccount({
  id: "yandex-1",
  email: "user@company.ru",
  display_name: "Yandex User",
  provider: "imap",
  auth_method: "oauth2",
  oauth_provider: "yandex",
  access_token: "access",
  refresh_token: "refresh",
  oauth_client_id: "client",
  oauth_granted_scopes: "login:email mail:imap_full mail:smtp calendar:all",
  calendar_provider: "caldav",
  caldav_url: "https://caldav.yandex.ru",
});

describe("Yandex 360 work account readiness", () => {
  it("parses space and comma separated OAuth scopes", () => {
    const scopes = parseYandexOAuthScopes("mail:imap_full, mail:smtp calendar:all");

    expect(scopes.has("mail:imap_full")).toBe(true);
    expect(scopes.has("mail:smtp")).toBe(true);
    expect(missingYandexScopes(scopes, ["mail:imap_full", "calendar:read"])).toEqual(["calendar:read"]);
  });

  it("shows mail and calendar as available for a normal Yandex 360 work account", () => {
    const [status] = buildYandex360WorkAccountStatuses([yandexAccount]);

    expect(status?.email).toBe("user@company.ru");
    expect(status?.services.find((service) => service.id === "mail")?.status).toBe("available");
    expect(status?.services.find((service) => service.id === "calendar")?.status).toBe("available");
    expect(status?.services.map((service) => service.id)).toEqual(["mail", "calendar", "messenger", "tracker"]);
  });

  it("surfaces missing mail scopes as a reauthable service issue", () => {
    const [status] = buildYandex360WorkAccountStatuses([
      createMockDbAccount({
        ...yandexAccount,
        oauth_granted_scopes: "login:email mail:imap_full calendar:all",
      }),
    ]);

    const mail = status?.services.find((service) => service.id === "mail");
    expect(mail?.status).toBe("needs_scope");
    expect(mail?.missingScopes).toEqual(["mail:smtp"]);
    expect(mail?.action).toBe("reauth");
  });

  it("routes expired Yandex OAuth diagnostics to reauth status", () => {
    const diagnostic = createConnectionDiagnostic("invalid_grant refresh token expired", {
      accountId: "yandex-1",
      layer: "oauth",
      operation: "refresh",
      provider: "imap",
      authMethod: "oauth2",
    });

    const [status] = buildYandex360WorkAccountStatuses([yandexAccount], [diagnostic]);

    expect(status?.needsReauth).toBe(true);
    expect(status?.services.find((service) => service.id === "mail")?.status).toBe("needs_reauth");
  });

  it("shows provider 403 and 429 diagnostics as human-readable limitations", () => {
    const forbidden = createConnectionDiagnostic("HTTP 403 forbidden: тариф не позволяет операцию", {
      accountId: "yandex-1",
      layer: "provider",
      operation: "messenger",
      provider: "imap",
      authMethod: "oauth2",
    });
    const [limited] = buildYandex360WorkAccountStatuses([yandexAccount], [forbidden]);

    expect(limited?.limitationMessage).toContain("Яндекс ограничил доступ");
    expect(limited?.services.find((service) => service.id === "messenger")?.status).toBe("limited");

    const throttled = createConnectionDiagnostic("HTTP 429 too many requests", {
      accountId: "yandex-1",
      layer: "provider",
      operation: "messenger",
      provider: "imap",
      authMethod: "oauth2",
    });
    const [rateLimited] = buildYandex360WorkAccountStatuses([yandexAccount], [throttled]);

    expect(rateLimited?.limitationMessage).toContain("частоту запросов");
  });
});
