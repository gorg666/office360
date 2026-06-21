import { describe, expect, it } from "vitest";
import { supportsFolderEditing } from "./providerCapabilities";

describe("supportsFolderEditing", () => {
  it.each(["gmail_api", "gmail", "google", " GOOGLE "])(
    "allows Gmail/Google provider %s",
    (provider) => {
      expect(supportsFolderEditing(provider)).toBe(true);
    },
  );

  it.each(["imap", "yandex", "manual", "caldav", "", undefined, null])(
    "blocks unsupported or unknown provider %s",
    (provider) => {
      expect(supportsFolderEditing(provider)).toBe(false);
    },
  );
});
