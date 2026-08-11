import { describe, it, expect } from "vitest";
import { isYandexYapicUrlLoginStubGuess, normalizeYandexUserInfo } from "./yandexProfile";

describe("isYandexYapicUrlLoginStubGuess", () => {
  it("returns true when yapic id equals mailbox local part", () => {
    expect(
      isYandexYapicUrlLoginStubGuess(
        "turbobarsuk@yandex.ru",
        "https://avatars.yandex.net/get-yapic/turbobarsuk/islands-200",
      ),
    ).toBe(true);
  });

  it("returns false for numeric default_avatar_id style URLs", () => {
    expect(
      isYandexYapicUrlLoginStubGuess(
        "user@yandex.ru",
        "https://avatars.yandex.net/get-yapic/131652443/islands-200",
      ),
    ).toBe(false);
  });
});

describe("normalizeYandexUserInfo", () => {
  it("builds picture URL from default_avatar_id", () => {
    const r = normalizeYandexUserInfo({
      id: "2179953958",
      default_email: "u@yandex.ru",
      login: "u",
      real_name: "U",
      default_avatar_id: "131652443",
    });
    expect(r.picture).toBe("https://avatars.yandex.net/get-yapic/131652443/islands-200");
    expect(r.subjectId).toBe("2179953958");
    expect(r.login).toBe("u");
  });

  it("does not use login as yapic id when default_avatar_id is missing", () => {
    const r = normalizeYandexUserInfo({
      default_email: "u@yandex.ru",
      login: "ivan",
      real_name: "Ivan",
    });
    expect(r.picture).toBeUndefined();
  });

  it("omits picture when is_avatar_empty is true", () => {
    const r = normalizeYandexUserInfo({
      default_email: "u@yandex.ru",
      default_avatar_id: "131652443",
      is_avatar_empty: true,
    });
    expect(r.picture).toBeUndefined();
  });
});
