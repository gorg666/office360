import { describe, expect, it } from "vitest";
import { isSafeRasterImagePreview } from "./fileTypeHelpers";

describe("isSafeRasterImagePreview", () => {
  it("allows jpeg/png/webp/gif", () => {
    expect(isSafeRasterImagePreview("image/jpeg", "a.jpg")).toBe(true);
    expect(isSafeRasterImagePreview("image/png", "a.png")).toBe(true);
    expect(isSafeRasterImagePreview("image/webp", "a.webp")).toBe(true);
    expect(isSafeRasterImagePreview("image/gif", "a.gif")).toBe(true);
  });

  it("rejects svg and archives", () => {
    expect(isSafeRasterImagePreview("image/svg+xml", "a.svg")).toBe(false);
    expect(isSafeRasterImagePreview("application/zip", "a.zip")).toBe(false);
    expect(isSafeRasterImagePreview("application/octet-stream", "a.exe")).toBe(false);
  });

  it("uses filename when mime missing", () => {
    expect(isSafeRasterImagePreview(null, "photo.JPEG")).toBe(true);
    expect(isSafeRasterImagePreview(null, "doc.pdf")).toBe(false);
  });
});
