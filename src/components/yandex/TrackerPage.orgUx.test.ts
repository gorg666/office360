import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("TrackerPage org UX copy", () => {
  const source = readFileSync(join(__dirname, "TrackerPage.tsx"), "utf8");

  it("does not show literal X-Org-ID in normal UI", () => {
    expect(source).not.toMatch(/X-Org-ID/);
    expect(source).toMatch(/Идентификатор организации/);
    expect(source).toMatch(/Организация Яндекс 360/);
    expect(source).toMatch(/Обновить доступ/);
  });
});
