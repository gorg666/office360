import { describe, expect, it } from "vitest";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import {
  canMutateRecurring,
  classifyRecurringEditTarget,
  defaultRecurrenceScope,
  recurrenceScopeChoices,
  writeFailureCopy,
} from "./recurrenceEditScope";

function capabilities(scopes: CalendarProviderCapabilities["recurrence"]["updateScopes"]): CalendarProviderCapabilities {
  return {
    events: { create: "remote", update: "remote", delete: "remote" },
    recurrence: { updateScopes: scopes, deleteScopes: scopes },
  } as CalendarProviderCapabilities;
}

const occurrence = classifyRecurringEditTarget({
  is_recurrence_master: 0,
  occurrence_key: "series-1::20270115T080000Z",
  series_uid: "series-1",
  uid: "series-1",
});

const master = classifyRecurringEditTarget({
  is_recurrence_master: 1,
  occurrence_key: null,
  series_uid: "series-1",
  uid: "series-1",
});

const plain = classifyRecurringEditTarget({
  is_recurrence_master: 0,
  occurrence_key: null,
  series_uid: null,
  uid: "plain-1",
});

describe("classifyRecurringEditTarget", () => {
  it("prefers occurrence identity over RRULE-like master flags", () => {
    expect(classifyRecurringEditTarget({
      is_recurrence_master: 1,
      occurrence_key: "series-1::20270115T080000Z",
      series_uid: "series-1",
      uid: "series-1",
    })).toEqual({
      kind: "occurrence",
      seriesUid: "series-1",
      occurrenceKey: "series-1::20270115T080000Z",
    });
  });

  it("classifies a series master without occurrence identity", () => {
    expect(master).toEqual({ kind: "series-master", seriesUid: "series-1" });
  });

  it("classifies a plain event even when uid is present", () => {
    expect(plain).toEqual({ kind: "plain" });
  });
});

describe("recurrenceScopeChoices", () => {
  it("offers single and series for an occurrence when capabilities allow them", () => {
    expect(recurrenceScopeChoices(capabilities(["single", "series"]), "update", occurrence).map((choice) => choice.scope))
      .toEqual(["single", "series"]);
  });

  it("does not offer single for a series master", () => {
    expect(recurrenceScopeChoices(capabilities(["single", "series"]), "update", master).map((choice) => choice.scope))
      .toEqual(["series"]);
  });

  it("hides this-and-future unless the capability is declared", () => {
    expect(recurrenceScopeChoices(capabilities(["single", "series"]), "delete", occurrence).map((choice) => choice.scope))
      .not.toContain("this-and-future");
  });

  it("surfaces this-and-future when the capability becomes supported", () => {
    expect(recurrenceScopeChoices(
      capabilities(["single", "series", "this-and-future"]),
      "update",
      occurrence,
    ).map((choice) => choice.scope)).toEqual(["single", "series", "this-and-future"]);
  });

  it("returns no choices for a plain event", () => {
    expect(recurrenceScopeChoices(capabilities(["single", "series"]), "update", plain)).toEqual([]);
  });
});

describe("defaultRecurrenceScope", () => {
  it("prefers single for an occurrence", () => {
    expect(defaultRecurrenceScope(recurrenceScopeChoices(capabilities(["single", "series"]), "update", occurrence)))
      .toBe("single");
  });
});

describe("canMutateRecurring", () => {
  it("allows occurrence mutation when only series is supported", () => {
    expect(canMutateRecurring(capabilities(["series"]), "update", occurrence)).toBe(true);
    expect(canMutateRecurring(capabilities(["series"]), "delete", occurrence)).toBe(true);
  });

  it("rejects mutation when the provider cannot write remotely", () => {
    const localOnly = {
      events: { create: "unsupported", update: "unsupported", delete: "unsupported" },
      recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
    } as CalendarProviderCapabilities;
    expect(canMutateRecurring(localOnly, "update", occurrence)).toBe(false);
  });
});

describe("writeFailureCopy", () => {
  it("maps typed mutation failures to production copy", () => {
    expect(writeFailureCopy({ status: "conflict", message: "etag" }))
      .toBe("Событие было изменено в другом месте. Обновите данные и попробуйте снова.");
    expect(writeFailureCopy({ status: "unsupported", message: "scope" }))
      .toBe("Этот способ изменения не поддерживается календарём.");
    expect(writeFailureCopy({ status: "permission-denied", message: "acl" }))
      .toBe("Недостаточно прав для изменения этого календаря.");
    expect(writeFailureCopy({ status: "network-error", message: "timeout" }))
      .toBe("Не удалось связаться с сервером календаря. Повторите попытку.");
  });
});
