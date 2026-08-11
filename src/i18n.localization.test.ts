import { describe, expect, it } from "vitest";
import { translateText, DEFAULT_LOCALE } from "@/i18n";
import { pluralRu, formatCountRu } from "@/utils/pluralRu";
import { toUserFacingError } from "@/utils/userFacingError";
import { formatRelativeDate } from "@/utils/date";

describe("i18n translateText", () => {
  it("resolves core mail UI to Russian", () => {
    expect(translateText("Inbox", "ru")).toBe("Входящие");
    expect(translateText("Send", "ru")).toBe("Отправить");
    expect(translateText("Retry", "ru")).toBe("Повторить");
    expect(translateText("Cc", "ru")).toBe("Копия");
    expect(translateText("Bcc", "ru")).toBe("Скрытая копия");
    expect(translateText("New mail", "ru")).toBe("Новое письмо");
    expect(translateText("(No subject)", "ru")).toBe("(Без темы)");
  });

  it("default locale is Russian", () => {
    expect(DEFAULT_LOCALE).toBe("ru");
  });
});

describe("pluralRu", () => {
  it("handles Russian plurals for messages", () => {
    expect(formatCountRu(1, "письмо", "письма", "писем")).toBe("1 письмо");
    expect(formatCountRu(2, "письмо", "письма", "писем")).toBe("2 письма");
    expect(formatCountRu(5, "письмо", "письма", "писем")).toBe("5 писем");
    expect(formatCountRu(21, "письмо", "письма", "писем")).toBe("21 письмо");
    expect(pluralRu(11, "письмо", "письма", "писем")).toBe("писем");
  });
});

describe("toUserFacingError", () => {
  it("maps network and auth errors to Russian", () => {
    expect(toUserFacingError(new Error("Failed to fetch"))).toMatch(/соединен|сервер/i);
    expect(toUserFacingError(new Error("AuthenticationFailed"))).toMatch(/Сессия|аккаунт|авториза/i);
    expect(toUserFacingError(new Error("SMTP error 535"))).toMatch(/Сессия|отправ|аккаунт/i);
  });
});

describe("formatRelativeDate locale", () => {
  it("returns Yesterday in Russian for previous day", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    expect(formatRelativeDate(d.getTime())).toBe("Вчера");
  });
});
