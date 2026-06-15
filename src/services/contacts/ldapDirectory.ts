import { invoke } from "@tauri-apps/api/core";
import { getContactDirectories, type ContactDirectory } from "@/services/db/contacts";
import { getSecureSetting } from "@/services/db/settings";

export interface LdapConnectionResult {
  success: boolean;
  message: string;
}

export interface LdapContactResult {
  dn: string;
  displayName: string | null;
  email: string | null;
  organization: string | null;
  title: string | null;
}

export async function testLdapDirectory(directoryId: string): Promise<LdapConnectionResult> {
  const directory = (await getContactDirectories()).find((item) => item.id === directoryId);
  if (!directory) return { success: false, message: "LDAP directory not found" };
  if (directory.kind !== "ldap") return { success: false, message: "Directory is not LDAP-backed" };
  return testLdapConnection(directory);
}

export async function testLdapConnection(directory: ContactDirectory): Promise<LdapConnectionResult> {
  if (!directory.ldap_host) return { success: false, message: "LDAP host is required" };
  try {
    return await invoke<LdapConnectionResult>("ldap_test_connection", {
      request: {
        host: directory.ldap_host,
        port: directory.ldap_port ?? 389,
        security: directory.ldap_security ?? "plain",
        timeoutMs: 5_000,
      },
    });
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? sanitizeLdapError(err.message) : sanitizeLdapError(String(err)),
    };
  }
}

export async function searchLdapDirectory(directoryId: string, query: string): Promise<LdapContactResult[]> {
  const directory = (await getContactDirectories()).find((item) => item.id === directoryId);
  if (!directory || directory.kind !== "ldap" || !directory.ldap_host || !directory.ldap_base_dn) return [];

  try {
    const password = directory.auth_ref ? await getSecureSetting(directory.auth_ref) : null;
    return await invoke<LdapContactResult[]>("ldap_search", {
      request: {
        host: directory.ldap_host,
        port: directory.ldap_port ?? (directory.ldap_security === "ldaps" ? 636 : 389),
        security: directory.ldap_security ?? "plain",
        bindDn: directory.ldap_bind_dn ?? undefined,
        password: password ?? undefined,
        baseDn: directory.ldap_base_dn,
        filter: directory.ldap_filter ?? "(|(mail=*{query}*)(cn=*{query}*)(displayName=*{query}*))",
        query,
        limit: 25,
      },
    });
  } catch {
    return [];
  }
}

export function sanitizeLdapError(message: string): string {
  return message
    .replace(/password[=:]\s*[^,\n]+/gi, "password=[redacted]")
    .replace(/bind\s+dn[=:]\s*[^,\n]+/gi, "bind dn=[redacted]")
    .slice(0, 500);
}
