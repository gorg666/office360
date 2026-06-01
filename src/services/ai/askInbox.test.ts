import { describe, expect, it } from "vitest";
import { buildAskInboxSearchQueries } from "./askInbox";

describe("buildAskInboxSearchQueries", () => {
  it("keeps short name queries searchable", () => {
    expect(buildAskInboxSearchQueries("Ефим Подоляк")[0]).toBe("ефим подоляк");
  });

  it("turns a long Russian question into focused fallback searches", () => {
    expect(buildAskInboxSearchQueries("Найди письмо с паспортными данными Ефима Подоляк")).toEqual([
      "паспорт данн ефим подоляк",
      "паспорт ефим подоляк",
      "ефим подоляк",
    ]);
  });
});
