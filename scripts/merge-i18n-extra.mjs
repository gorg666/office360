#!/usr/bin/env node
/** Merge scripts/i18n-extra-ru.json into src/i18n.ts ru dictionary (skip existing keys). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const I18N = path.join(ROOT, "src/i18n.ts");
const EXTRA = path.join(ROOT, "scripts/i18n-extra-ru.json");

const i18n = fs.readFileSync(I18N, "utf8");
const extra = JSON.parse(fs.readFileSync(EXTRA, "utf8"));

const start = i18n.indexOf("const ru:");
const endMarker = "\n};";
const end = i18n.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("ru object bounds not found");

const slice = i18n.slice(start, end + endMarker.length);
const existing = new Set();
for (const m of slice.matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*:/gm)) {
  existing.add(JSON.parse(`"${m[1]}"`));
}

const lines = [];
let added = 0;
for (const [en, ru] of Object.entries(extra)) {
  if (typeof en !== "string" || typeof ru !== "string") continue;
  if (existing.has(en)) continue;
  lines.push(`  ${JSON.stringify(en)}: ${JSON.stringify(ru)},`);
  added++;
}

if (added === 0) {
  console.log("No new keys to merge");
  process.exit(0);
}

const insertAt = end; // before \n};
const next =
  i18n.slice(0, insertAt) +
  "\n  // --- auto-merged from scripts/i18n-extra-ru.json ---\n" +
  lines.join("\n") +
  i18n.slice(insertAt);

fs.writeFileSync(I18N, next);
console.log(`Merged ${added} keys into i18n.ts (skipped ${Object.keys(extra).length - added} existing)`);
