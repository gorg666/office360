/*
 * DESIGN-001B styleguide — dev-only.
 *
 * Not part of any production bundle: vite.config.ts lists `index.html` and
 * `splashscreen.html` as the only rollup inputs, and tsconfig only includes
 * `src`. This exists so the foundation can be reviewed against real rendered
 * components in both themes rather than against a screenshot of a mock.
 *
 *   npm run dev  ->  http://localhost:<port>/design-lab/styleguide.html
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Mail, Star, Trash2, Search, Plus } from "lucide-react";

import "@/styles/globals.css";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Select } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Chip } from "@/components/ui/Chip";
import { Banner } from "@/components/ui/Banner";
import { Toggle } from "@/components/ui/Toggle";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="mb-1 text-caption font-semibold uppercase tracking-wider text-ink-tertiary">{title}</h2>
      {note && <p className="mb-3 max-w-2xl text-caption text-ink-tertiary">{note}</p>}
      <div className="surface-raised rounded-panel border border-separator p-5 shadow-e1">{children}</div>
    </section>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3">{children}</div>
);

function Styleguide() {
  const [dark, setDark] = useState(false);
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [notify, setNotify] = useState(true);
  const [checked, setChecked] = useState(true);

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
    <div className="surface-base min-h-screen p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-page font-semibold text-ink-primary">Office360 — design foundation</h1>
          <p className="mt-1 text-meta text-ink-tertiary">DESIGN-001B · tokens, materials, primitives</p>
        </div>
        <Toggle checked={dark} onChange={toggleTheme} label="Тёмная тема" />
      </header>

      <Section
        title="Type scale"
        note="Replaces a two-size (12/14 px) reality plus ten arbitrary sizes below 12 px. Tracking is size-specific; 11 px is the floor."
      >
        <div className="space-y-2">
          <p className="text-hero text-ink-primary">Hero 28 — display</p>
          <p className="text-page text-ink-primary">Page 20 — page title</p>
          <p className="text-section text-ink-primary">Section 16 — modal &amp; section title</p>
          <p className="text-copy text-ink-primary">Copy 14 — body text and subject lines</p>
          <p className="text-meta text-ink-secondary">Meta 13 — sender, snippet, metadata</p>
          <p className="text-control text-ink-secondary">Control 13 — buttons, menu items, inputs</p>
          <p className="text-caption text-ink-tertiary">Caption 11 — timestamps, badges, hour gutter</p>
        </div>
      </Section>

      <Section title="Buttons" note="Five variants × four sizes, each with hover, pressed, focus-visible, disabled and loading.">
        <div className="space-y-4">
          <Row>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Row>
          <Row>
            <Button size="xs">xs</Button>
            <Button size="sm">sm</Button>
            <Button size="md">md</Button>
            <Button size="lg">lg</Button>
          </Row>
          <Row>
            <Button variant="primary" icon={<Plus size={13} />}>С иконкой</Button>
            <Button variant="primary" loading>Загрузка</Button>
            <Button variant="primary" disabled>Disabled</Button>
            <Button variant="secondary" iconOnly icon={<Star size={14} />} aria-label="В избранное" />
            <Button variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label="Удалить" />
          </Row>
        </div>
      </Section>

      <Section
        title="Materials"
        note="Glass never sits under running text. Base and solid are opaque; the three glass levels are chrome only. The swatches sit on a patterned backdrop because a translucent surface over a white parent is indistinguishable from white — which is exactly the failure mode this system exists to prevent."
      >
        <div className="grid grid-cols-2 gap-3 rounded-card p-4 md:grid-cols-5"
             style={{ backgroundImage: "linear-gradient(115deg,#5d55d8 0%,#8b5cf6 30%,#2e90fa 62%,#079455 100%)" }}>
          {([
            ["surface-base", "Base canvas"],
            ["surface-solid", "Solid pane"],
            ["material-subtle", "Glass subtle"],
            ["material-elevated", "Glass elevated"],
            ["material-modal", "Glass modal"],
          ] as const).map(([cls, label]) => (
            <div key={cls} className={`${cls} rounded-card p-4 text-center`}>
              <div className="text-meta font-medium text-ink-primary">{label}</div>
              <div className="mt-1 text-caption text-ink-tertiary">.{cls}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Radius & elevation"
        note="In dark mode the four shadow steps are almost invisible, and that is deliberate: shadows barely read on a dark canvas, so depth there comes from the lightness step between surface-base, -solid and -raised instead."
      >
        <div className="space-y-4">
          {/* class names are written out in full: Tailwind scans source text,
              so an interpolated `rounded-${r}` would never be generated */}
          <Row>
            {([
              ["rounded-tight", "tight 4"],
              ["rounded-control", "control 8"],
              ["rounded-card", "card 12"],
              ["rounded-panel", "panel 16"],
              ["rounded-sheet", "sheet 20"],
            ] as const).map(([cls, label]) => (
              <div key={cls} className={`surface-sunken ${cls} px-4 py-3 text-caption text-ink-secondary`}>
                {label}
              </div>
            ))}
          </Row>
          <div className="surface-base -mx-2 flex flex-wrap items-center gap-5 rounded-card px-5 py-6">
            {([
              ["shadow-e1", "e1"],
              ["shadow-e2", "e2"],
              ["shadow-e3", "e3"],
              ["shadow-e4", "e4"],
            ] as const).map(([cls, label]) => (
              <div key={cls} className={`surface-raised ${cls} rounded-card px-5 py-4 text-caption text-ink-secondary`}>
                shadow-{label}
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Fields" note="One focus ring across every control, replacing 73 uses of focus:border-accent.">
        <div className="grid max-w-2xl gap-4 md:grid-cols-2">
          <TextField label="Тема" placeholder="Введите тему" />
          <TextField label="Email" defaultValue="не-email" error="Некорректный адрес" />
          <TextField label="Отображаемое имя" hint="Видно получателям" placeholder="Имя" />
          <Select label="Показывать" defaultValue="all">
            <option value="all">Все</option>
            <option value="unread">Непрочитанные</option>
            <option value="read">Прочитанные</option>
          </Select>
        </div>
      </Section>

      <Section title="Selection controls">
        <div className="space-y-4">
          <Row>
            <SegmentedControl
              label="Представление"
              value={view}
              onChange={setView}
              options={[
                { value: "day", label: "День" },
                { value: "week", label: "Неделя" },
                { value: "month", label: "Месяц" },
              ]}
            />
          </Row>
          <Row>
            <Checkbox checked={checked} onChange={setChecked} label="Выделить всё" />
            <Checkbox checked={false} indeterminate onChange={() => {}} label="Частично" />
            <Checkbox checked={false} onChange={() => {}} label="Отключено" disabled />
          </Row>
          <Toggle checked={notify} onChange={setNotify} label="Уведомления" description="Показывать баннер о новых письмах" />
        </div>
      </Section>

      <Section title="Chips">
        <Row>
          <Chip tone="brand" onRemove={() => {}}>Георгий Коротков</Chip>
          <Chip tone="neutral">+3</Chip>
          <Chip tone="success">Доставлено</Chip>
          <Chip tone="warning">В очереди</Chip>
          <Chip tone="danger">Ошибка</Chip>
          <Chip tone="info">Черновик</Chip>
        </Row>
      </Section>

      <Section title="Banners" note="Tinted surface + dark text. The old offline banner was white on #d97706 — 3.19:1, below the AA floor.">
        <div className="max-w-2xl space-y-3">
          <Banner tone="info" title="Синхронизация">Последнее обновление 2 минуты назад.</Banner>
          <Banner tone="warning" title="Нет сети">Изменения синхронизируются после восстановления связи.</Banner>
          <Banner
            tone="danger"
            title="Синхронизация не удалась"
            actions={<Button size="xs" variant="secondary">Повторить</Button>}
            onDismiss={() => {}}
          >
            Не удалось подключиться к серверу.
          </Banner>
          <Banner tone="success" title="Отправлено">Письмо доставлено получателям.</Banner>
        </div>
      </Section>

      <Section title="Empty state">
        <div className="surface-solid h-64 rounded-card border border-hairline">
          <EmptyState
            icon={Search}
            title="Ничего не найдено"
            subtitle="Попробуйте изменить запрос или снять фильтры."
            action={<Button variant="primary" size="md" icon={<Mail size={13} />}>Новое письмо</Button>}
          />
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Styleguide />
  </StrictMode>,
);
