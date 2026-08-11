import { describe, expect, it } from "vitest";
import {
  MAIL_SYNC_MECHANISM,
  SYNC_INTERVAL_HIDDEN_MS,
  SYNC_INTERVAL_VISIBLE_MS,
} from "./syncManager";

describe("mail sync scheduler constants", () => {
  it("documents adaptive polling intervals", () => {
    expect(MAIL_SYNC_MECHANISM).toBe("adaptive_polling");
    expect(SYNC_INTERVAL_VISIBLE_MS).toBe(10_000);
    expect(SYNC_INTERVAL_HIDDEN_MS).toBe(120_000);
  });
});
