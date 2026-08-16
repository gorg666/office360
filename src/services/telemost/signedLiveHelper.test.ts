import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = readFileSync(resolve(ROOT, "scripts/telemost-wkwebview-x64-signed-live.sh"), "utf8");
const PACKAGE = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("telemost signed x86 live helper contract", () => {
  it("exposes verify/status/logs npm scripts without launching", () => {
    expect(PACKAGE.scripts["telemost:wk:x64-signed-live"]).toBe(
      "bash scripts/telemost-wkwebview-x64-signed-live.sh",
    );
    expect(PACKAGE.scripts["telemost:wk:x64-signed-verify"]).toBe(
      "bash scripts/telemost-wkwebview-x64-signed-live.sh verify",
    );
    expect(PACKAGE.scripts["telemost:wk:x64-signed-status"]).toBe(
      "bash scripts/telemost-wkwebview-x64-signed-live.sh status",
    );
    expect(PACKAGE.scripts["telemost:wk:x64-signed-logs"]).toBe(
      "bash scripts/telemost-wkwebview-x64-signed-live.sh logs",
    );
  });

  it("prints the overnight preflight block and launches the verified executable", () => {
    for (const line of [
      "OFFICE360 SIGNED LIVE PREFLIGHT",
      "ARCH:",
      "APP:",
      "EXECUTABLE:",
      "BUNDLE ID:",
      "SIGNATURE:",
      "CAMERA ENTITLEMENT:",
      "MIC ENTITLEMENT:",
      "NETWORK ENTITLEMENT:",
      "CAMERA USAGE:",
      "MIC USAGE:",
      "CODESIGN VERIFY:",
      "READY FOR LIVE TCC:",
    ]) {
      expect(SCRIPT).toContain(line);
    }
    expect(SCRIPT).toContain('BUNDLE_ID="com.office360.desktop"');
    expect(SCRIPT).toContain('EXPECTED_ARCH="x86_64"');
    expect(SCRIPT).toContain("$APP/Contents/MacOS/Office360");
    expect(SCRIPT).toContain('"$verified_exe"');
    expect(SCRIPT).toContain("verified executable drifted before launch");
  });

  it("does not use codesign --deep as the signing strategy and does not mutate TCC", () => {
    expect(SCRIPT).not.toMatch(/codesign[^\n]*--deep/);
    expect(SCRIPT).toContain("sign_nested_code");
    expect(SCRIPT).not.toMatch(/tccutil\s+reset/);
    expect(SCRIPT).not.toMatch(/sqlite3\s+.*DELETE/i);
    expect(SCRIPT).toContain("read-only");
    expect(SCRIPT).toContain("Does not declare media PASS");
  });

  it("fails closed on Darwin/x86_64/signing mismatches", () => {
    expect(SCRIPT).toContain('uname -s');
    expect(SCRIPT).toContain('uname -m');
    expect(SCRIPT).toContain("signed preflight rejected this bundle; not launching");
    expect(SCRIPT).toContain("codesign --verify --strict");
    expect(SCRIPT).toContain("com.apple.security.device.camera");
    expect(SCRIPT).toContain("com.apple.security.device.audio-input");
    expect(SCRIPT).toContain("com.apple.security.network.client");
    expect(SCRIPT).toContain("NSCameraUsageDescription");
    expect(SCRIPT).toContain("NSMicrophoneUsageDescription");
  });

  it("rejects leftover CEF payload in the signed macOS app", () => {
    expect(SCRIPT).toContain("assert_no_cef_payload");
    expect(SCRIPT).toContain("cef-runtime is still inside");
    expect(SCRIPT).toContain("signed macOS app must be CEF-free");
    expect(SCRIPT).toContain("Office360 executable still links CEF");
    expect(SCRIPT).toContain("Chromium Embedded Framework");
  });

  it("keeps cef-runtime out of the shared and macOS Tauri bundles", () => {
    const macos = readFileSync(resolve(ROOT, "src-tauri/tauri.macos.conf.json"), "utf8");
    const shared = readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8");
    const windows = readFileSync(resolve(ROOT, "src-tauri/tauri.windows.conf.json"), "utf8");
    const dmg = readFileSync(resolve(ROOT, "scripts/package-macos-dmg.sh"), "utf8");
    expect(macos).not.toContain("cef-runtime");
    expect(shared).not.toContain("cef-runtime");
    expect(windows).toContain("cef-runtime/**/*");
    expect(dmg).not.toContain("build-cef-host-macos");
    expect(dmg).toContain("Office360-macOS-Intel-x86_64.dmg");
    expect(dmg).toContain("Office360-macOS-Apple-Silicon-arm64.dmg");
    expect(dmg).not.toContain("Office360CEF.app");
    expect(dmg).toContain("assert_no_cef_payload");
  });
});
