import { beforeEach, describe, expect, it } from "vitest";
import { getTelemostCapability, setTelemostCapability } from "./capability";

beforeEach(() => localStorage.clear());

describe("Telemost capability", () => {
  it("starts unknown and persists per account", () => {
    expect(getTelemostCapability("a")).toBe("UNKNOWN");
    setTelemostCapability("a", "WEB_ONLY");
    setTelemostCapability("b", "API_AVAILABLE");
    expect(getTelemostCapability("a")).toBe("WEB_ONLY");
    expect(getTelemostCapability("b")).toBe("API_AVAILABLE");
  });
});
