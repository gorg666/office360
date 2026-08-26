#!/usr/bin/env node
/**
 * Dev audit: find likely user-visible English UI literals not covered by src/i18n.ts.
 * Usage: node scripts/i18n-audit.mjs [--json] [--fail]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const I18N = path.join(SRC, "i18n.ts");
const FAIL = process.argv.includes("--fail");
const AS_JSON = process.argv.includes("--json");

const SKIP_DIRS = new Set(["graphify-out", "node_modules", "dist", "coverage"]);
const SKIP_FILES = /(^|[\\/])(i18n\.ts|TranslationLayer\.tsx|.+\.test\.(ts|tsx)|.+\.spec\.(ts|tsx))$/;
/** Paths that are not user-facing product UI (migrations, AI prompts, parsers). */
const SKIP_PATH_RE =
  /[\\/](services[\\/]db[\\/]|services[\\/]ai[\\/]|services[\\/]gmail[\\/]messageParser|test[\\/]|mocks[\\/])/;

/** Exact / brand / protocol strings that may remain Latin in UI. */
const ALLOWLIST_EXACT = new Set([
  "Gmail",
  "Google",
  "IMAP",
  "SMTP",
  "CalDAV",
  "OAuth",
  "PKCE",
  "SSL",
  "TLS",
  "SSL/TLS",
  "API",
  "AI",
  "VIP",
  "URL",
  "Email",
  "Office360",
  "Офис360",
  "Yandex",
  "Яндекс",
  "GitHub",
  "Outlook",
  "Hotmail",
  "Live",
  "iCloud",
  "Fastmail",
  "Nextcloud",
  "Ollama",
  "LMStudio",
  "LM Studio",
  "Anthropic",
  "OpenAI",
  "Claude",
  "DevTools",
  "WebView",
  "Tauri",
  "Client ID",
  "Client Secret",
  "Google Cloud Console",
  "Google AI",
  "RFC 8058",
  "Cc", // may still need RU "Копия" — tracked separately if used as visible label without i18n
  "Bcc",
]);

const ALLOWLIST_RE = [
  /^https?:\/\//i,
  /^mailto:/i,
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /^[a-z0-9_-]+\/[a-z0-9_.+-]+$/i, // mime
  /^application\//i,
  /^text\//i,
  /^image\//i,
  /^#[0-9a-fA-F]{3,8}$/,
  /^[A-Z][A-Z0-9_]{1,24}$/, // ENUM-like
  /^[a-z]+([A-Z][a-zA-Z0-9]*)+$/, // camelCase identifiers accidentally matched
  /^\d+$/,
  /^v?\d+(\.\d+)+$/,
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(p, out);
      continue;
    }
    if (/\.(tsx|ts)$/.test(ent.name) && !SKIP_FILES.test(p) && !SKIP_PATH_RE.test(p)) out.push(p);
  }
  return out;
}

function loadDictKeys(i18nSrc) {
  const keys = new Set();
  const start = i18nSrc.indexOf("const ru:");
  if (start < 0) throw new Error("const ru not found in i18n.ts");
  const end = i18nSrc.indexOf("\n};", start);
  const slice = i18nSrc.slice(start, end + 3);
  for (const m of slice.matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*:/gm)) {
    keys.add(JSON.parse(`"${m[1]}"`));
  }
  return keys;
}

function moduleOf(file) {
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  const parts = rel.split("/");
  if (parts[0] === "components") return parts[1] || "components";
  return parts[0] || "src";
}

function isAllowed(text) {
  if (ALLOWLIST_EXACT.has(text)) return true;
  return ALLOWLIST_RE.some((re) => re.test(text));
}

function normalizeUiText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function consider(hits, seen, file, text, kind) {
  let t = normalizeUiText(text);
  if (t.length < 2 || t.length > 140) return;
  if (!/[A-Za-z]{3,}/.test(t)) return;
  // Skip Cyrillic-dominant / already-RU UI
  if (/[А-Яа-яЁё]/.test(t)) return;
  // Skip mostly-code tokens
  if (/[{}();=<>`]/.test(t)) return;
  if (/\b(void|Promise|string|number|boolean|typeof|keyof)\b/.test(t)) return;
  if (/^(use|get|set|is|has|on|handle|create|update|delete|fetch|load|save)[A-Z]/.test(t)) return;
  if (/^[a-z0-9_./:-]+$/.test(t)) return;
  if (isAllowed(t)) return;
  if (t.startsWith(",") || t.includes("*/") || t.includes("?:") || t.includes("&&")) return;
  if (/Map$|Set$|Record$|ArrayBuffer/.test(t)) return;
  if (t === "Apache License 2.0" || t === "GitHub Copilot") return; // legal / brand
  if (/^(Search|MailOpen|Paperclip)/.test(t) && t.includes(",")) return; // icon name lists
  // Must look like English UI (space or Capitalized word)
  if (!/[A-Z][a-z]{2,}/.test(t) && !/\s/.test(t)) return;
  const key = `${file}|${t}|${kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), text: t, kind, module: moduleOf(file) });
}

const PROP_RE =
  /(?:label|title|placeholder|aria-label|alt|description|emptyTitle|emptyMessage|emptyDescription|confirmLabel|cancelLabel|buttonLabel|toastTitle|toastMessage|statusLabel)\s*[:=]\s*["']([^"']{2,})["']/gi;
const JSX_TEXT_RE = />(\s*[^<>{}\n][^<>{}]*?[A-Za-z][^<>{}]*?\s*)</g;
// Common toast / showToast / setError string args with Capitalized English
const TOAST_RE =
  /(?:showToast|toast(?:\.(?:success|error|info|warning))?|setError|setStatus|setMessage)\s*\(\s*["']([A-Z][^"']{2,100})["']/g;

const dictKeys = loadDictKeys(fs.readFileSync(I18N, "utf8"));
const files = walk(SRC);
const hits = [];
const seen = new Set();

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  let m;
  PROP_RE.lastIndex = 0;
  while ((m = PROP_RE.exec(src))) {
    const t = normalizeUiText(m[1]);
    if (!dictKeys.has(t)) consider(hits, seen, file, t, "prop");
  }
  JSX_TEXT_RE.lastIndex = 0;
  while ((m = JSX_TEXT_RE.exec(src))) {
    const t = normalizeUiText(m[1]);
    if (!dictKeys.has(t)) consider(hits, seen, file, t, "jsx");
  }
  TOAST_RE.lastIndex = 0;
  while ((m = TOAST_RE.exec(src))) {
    const t = normalizeUiText(m[1]);
    if (!dictKeys.has(t)) consider(hits, seen, file, t, "toast");
  }
}

hits.sort((a, b) => a.module.localeCompare(b.module) || a.file.localeCompare(b.file) || a.text.localeCompare(b.text));

const byModule = {};
for (const h of hits) byModule[h.module] = (byModule[h.module] || 0) + 1;

const summary = {
  dictKeys: dictKeys.size,
  candidatesMissingFromDict: hits.length,
  byModule,
  hits,
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`i18n dict keys: ${dictKeys.size}`);
  console.log(`Missing UI candidates: ${hits.length}`);
  console.log("By module:", byModule);
  for (const h of hits.slice(0, 80)) {
    console.log(`- [${h.module}] ${h.kind}: "${h.text}" @ ${h.file}`);
  }
  if (hits.length > 80) console.log(`... +${hits.length - 80} more`);
}

const outDir = path.join(ROOT, "docs/qa");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "_i18n_scan_raw.json"), JSON.stringify(summary, null, 2));

if (FAIL && hits.length > 0) process.exit(1);
