/*
 * Mail visual smoke — dev-only, DESIGN-001D.
 *
 * Renders the real ThreadCard, CategoryTabs, SecurityWarningBanner, attachment
 * list and PeoplePicker against fixtures. The browser preview of the full app
 * has no Tauri/SQLite backend, so a real inbox never loads there — this is how
 * the row states, banners and attachment chrome get reviewed.
 *
 * Not in any production bundle — see design-lab/README.md.
 *
 *   npm run dev  ->  /design-lab/mail.html
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import "@/styles/globals.css";

import { ThreadCard } from "@/components/email/ThreadCard";
import { SecurityWarningBanner } from "@/components/email/SecurityWarningBanner";
import { PeoplePicker } from "@/components/people/PeoplePicker";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { EmailListSkeleton } from "@/components/ui/Skeleton";
import type { Thread } from "@/stores/threadStore";
import type { SecurityWarning } from "@/services/security/securityWarnings";

// formatRelativeDate() takes milliseconds.
const now = Date.now();

function thread(over: Partial<Thread> & { id: string }): Thread {
  return {
    accountId: "acc",
    subject: "Без темы",
    snippet: "Короткий фрагмент письма для предпросмотра.",
    lastMessageAt: now - 3_600_000,
    messageCount: 1,
    isRead: true,
    isStarred: false,
    isPinned: false,
    isMuted: false,
    hasAttachments: false,
    labelIds: [],
    fromName: "Отправитель",
    fromAddress: "sender@example.com",
    ...over,
  };
}

const THREADS: Thread[] = [
  thread({
    id: "t1",
    isRead: false,
    fromName: "Анна Ковалёва",
    fromAddress: "anna@example.com",
    subject: "Правки по макету дашборда — нужен ваш взгляд до пятницы",
    snippet: "Привет! Посмотри, пожалуйста, второй вариант сетки — там поменялась плотность строк.",
    hasAttachments: true,
  }),
  thread({
    id: "t2",
    isRead: false,
    fromName: "Борис Титов",
    fromAddress: "boris@example.com",
    subject: "Re: Деплой платформы",
    snippet: "Выкатили на стенд, метрики в норме.",
    lastMessageAt: now - 7_200_000,
    messageCount: 4,
  }),
  thread({
    id: "t3",
    fromName: "Вера Смирнова",
    fromAddress: "vera@example.com",
    subject: "Отчёт по регрессу за неделю",
    snippet: "Прикладываю сводку: 3 новых дефекта, 11 закрыто.",
    lastMessageAt: now - 86_400_000,
    isStarred: true,
    hasAttachments: true,
  }),
  thread({
    id: "t4",
    fromName: "Очень Длинное Имя Отправителя Которое Не Помещается В Колонку",
    fromAddress: "long@example.com",
    subject:
      "Тема письма, которая намеренно очень длинная, чтобы проверить обрезание и то, что строка не переносится и не ломает плотность списка",
    snippet:
      "И сниппет тоже длинный, чтобы проверить, что он обрезается в одну строку и не растягивает строку списка по высоте.",
    lastMessageAt: now - 172_800_000,
    isPinned: true,
  }),
  thread({
    id: "t5",
    fromName: "Дежурная служба",
    fromAddress: "oncall@example.com",
    subject: "Инцидент закрыт",
    snippet: "Postmortem назначен на понедельник.",
    lastMessageAt: now - 259_200_000,
    isMuted: true,
    messageCount: 12,
  }),
];

const WARNINGS: SecurityWarning[] = [
  {
    accountId: "acc",
    messageId: "m1",
    kind: "remote_content",
    severity: "info",
    reason: "Письмо содержит изображения, загружаемые с внешних серверов.",
    recommendedAction: "Загружайте, только если доверяете отправителю.",
    actions: ["allow_once", "always_allow_sender"],
  },
  {
    accountId: "acc",
    messageId: "m2",
    kind: "sender_auth",
    severity: "warning",
    reason: "DKIM-подпись отправителя не прошла проверку.",
    recommendedAction: "Проверьте адрес отправителя перед ответом.",
    actions: ["inspect", "report"],
  },
  {
    accountId: "acc",
    messageId: "m3",
    kind: "suspicious_link",
    severity: "danger",
    reason: "Ссылки в письме ведут на домен, не совпадающий с текстом ссылки.",
    recommendedAction: "Не переходите по ссылкам и не вводите учётные данные.",
    actions: ["inspect", "report"],
  },
] as unknown as SecurityWarning[];

const PEOPLE = [
  { name: "Анна Ковалёва", email: "anna@example.com", jobTitle: "Продуктовый дизайнер", department: "Дизайн" },
  { name: "Борис Титов", email: "boris@example.com", jobTitle: "Backend-инженер", department: "Платформа" },
  { name: "Артур Лебедев", email: "artur@example.com", jobTitle: null, department: null },
];

const searchPeople = async (input: { query: string }) => ({
  people: PEOPLE.filter((p) =>
    `${p.name} ${p.email}`.toLowerCase().includes(input.query.toLowerCase()),
  ).map((p) => ({
    displayName: p.name,
    email: p.email,
    normalizedEmail: p.email.toLowerCase(),
    jobTitle: p.jobTitle,
    department: p.department,
    avatarUrl: null,
    source: "directory" as const,
  })),
  directorySearch: "ok" as const,
});

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-caption font-semibold uppercase tracking-wider text-ink-tertiary">{title}</h2>
      {note && <p className="mb-2 max-w-2xl text-caption text-ink-tertiary">{note}</p>}
      {children}
    </section>
  );
}

function Harness() {
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [selectedId, setSelectedId] = useState("t2");
  const [recipients, setRecipients] = useState<any[]>([]);

  const toggleTheme = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.setProperty(
      "--app-window-gradient",
      next
        ? "linear-gradient(135deg, #0a0a0a 0%, #171717 45%, #262626 100%)"
        : "linear-gradient(135deg, #fafafa 0%, #f5f5f5 35%, #eeeeee 70%, #ffffff 100%)",
    );
  };

  return (
    <div className="surface-base min-h-screen">
      <div className="flex items-center gap-6 border-b border-separator px-4 py-2">
        <span className="text-meta font-semibold text-ink-primary">Mail visual smoke</span>
        <Toggle checked={dark} onChange={toggleTheme} label="Тёмная тема" />
        <Toggle checked={narrow} onChange={setNarrow} label="Narrow desktop" />
      </div>

      <div className={`mx-auto p-6 ${narrow ? "max-w-[760px]" : "max-w-[1200px]"}`}>
        <Section
          title="Message list"
          note="Первая строка — непрочитанное, вторая — выбранная, четвёртая проверяет очень длинные имя/тему/сниппет. Наведение меняет только фон: строки больше не приподнимаются."
        >
          <div className="surface-solid overflow-hidden rounded-card border border-separator">
            {THREADS.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                isSelected={t.id === selectedId}
                onClick={() => setSelectedId(t.id)}
                hasFollowUp={t.id === "t3"}
              />
            ))}
          </div>
        </Section>

        <Section title="Loading">
          <div className="surface-solid overflow-hidden rounded-card border border-separator">
            <EmailListSkeleton count={3} />
          </div>
        </Section>

        <Section
          title="Security banners"
          note="Один Banner-контракт: тонированная поверхность и тёмный текст вместо насыщенной заливки с белым текстом."
        >
          <div className="max-w-2xl space-y-3">
            {WARNINGS.map((w, i) => (
              <SecurityWarningBanner
                key={i}
                warning={w}
                onAction={() => {}}
                onDismiss={i === 0 ? () => {} : undefined}
                trailing={
                  i === 2 ? (
                    <Button size="xs" variant="secondary">
                      Доверять
                    </Button>
                  ) : undefined
                }
              />
            ))}
            <Banner tone="success" title="Отправлено">
              Письмо доставлено получателям.
            </Banner>
          </div>
        </Section>

        <Section title="Recipients (To / Cc / Bcc)" note="Введите «а», чтобы раскрыть каталог.">
          <div className="surface-raised max-w-2xl space-y-3 rounded-card border border-separator p-4">
            {(["Кому", "Копия", "Скрытая копия"] as const).map((label) => (
              <div key={label} className="flex items-start gap-3">
                <span className="w-24 shrink-0 pt-2 text-caption font-medium text-ink-tertiary">{label}</span>
                <div className="min-w-0 flex-1">
                  <PeoplePicker
                    label={label}
                    selected={label === "Кому" ? recipients : []}
                    onChange={label === "Кому" ? setRecipients : () => {}}
                    search={searchPeople as any}
                    debounceMs={0}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
