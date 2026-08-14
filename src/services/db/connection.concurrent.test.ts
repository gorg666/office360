import { describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockDb = { execute: mockExecute, select: vi.fn() };
const mockLoad = vi.fn().mockResolvedValue(mockDb);

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: mockLoad },
}));

describe("getDb concurrent initialization", () => {
  it("shares one Database.load across concurrent callers", async () => {
    const { getDb } = await import("./connection");
    const databases = await Promise.all(Array.from({ length: 8 }, () => getDb()));

    expect(new Set(databases).size).toBe(1);
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
});
