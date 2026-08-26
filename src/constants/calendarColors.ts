/**
 * Calendar colour mapping — DESIGN-001C.
 *
 * Every event used to render as `bg-accent/10 text-accent`, so events from
 * different calendars were indistinguishable. This maps a calendar to a
 * consistent set of surfaces:
 *
 *     calendar -> { marker, fill, border, text }
 *
 * with separate values for light and dark. The provider colour (`calendars.color`)
 * is used when present; otherwise a stable hue is picked by hashing the calendar
 * id, so the same calendar always looks the same across sessions and devices.
 *
 * Text is not simply "the calendar colour": it is darkened (light theme) or
 * lightened (dark theme) until it clears the WCAG AA 4.5:1 contrast floor
 * against the fill it sits on. That step is what makes arbitrary
 * provider-supplied colours safe to render text on.
 *
 * Pure module — no React, no DB, no I/O — so the contrast guarantees are unit
 * testable. It carries no domain meaning and changes no calendar behaviour.
 */

export interface CalendarColorSet {
  /** The calendar's own colour: dots, the left bar on an event, list swatches. */
  marker: string;
  /** Event chip background. */
  fill: string;
  /** Event chip border. */
  border: string;
  /** Event chip text — guaranteed >= 4.5:1 against `fill`. */
  text: string;
}

/** Fallback hues for calendars whose provider sends no colour. */
export const CALENDAR_PALETTE: readonly string[] = [
  "#5d55d8", // brand violet
  "#2e90fa", // blue
  "#079455", // green
  "#dc6803", // amber
  "#d92d20", // red
  "#7839ee", // purple
  "#0e9384", // teal
  "#e31b54", // pink
];

const SURFACE_LIGHT: RGB = { r: 255, g: 255, b: 255 };
const SURFACE_DARK: RGB = { r: 20, g: 20, b: 25 };

interface RGB {
  r: number;
  g: number;
  b: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function parseHex(value: string | null | undefined): RGB | null {
  if (!value) return null;
  let hex = value.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length === 8) hex = hex.slice(0, 6); // ignore provider alpha
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

const toHex = ({ r, g, b }: RGB) =>
  "#" + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("");

/** Deterministic hash so a calendar keeps its colour across sessions. */
export function hashToIndex(id: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % buckets;
}

function mix(a: RGB, b: RGB, amountOfA: number): RGB {
  return {
    r: clamp255(a.r * amountOfA + b.r * (1 - amountOfA)),
    g: clamp255(a.g * amountOfA + b.g * (1 - amountOfA)),
    b: clamp255(a.b * amountOfA + b.b * (1 - amountOfA)),
  };
}

const channelLuminance = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance({ r, g, b }: RGB): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body-size text. Event titles render at caption size. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * Push `colour` toward black (light theme) or white (dark theme) until it clears
 * the contrast floor against `fill`. Returns the most readable value it can
 * reach, so an extreme provider colour degrades to plain black/white rather
 * than to something illegible.
 */
function readableInk(colour: RGB, fill: RGB, dark: boolean): RGB {
  const target: RGB = dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  let best = colour;
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(colour, target, 1 - step / 20);
    best = candidate;
    if (contrastRatio(candidate, fill) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return best;
}

export interface CalendarColorSource {
  id: string;
  color?: string | null;
}

/**
 * Resolve a calendar's rendering colours.
 *
 * `dark` selects the material set: the same calendar gets a deeper fill and
 * lighter text in dark mode, because a 14% tint that reads as "tinted white"
 * on a light pane reads as "almost invisible" on a dark one.
 */
export function calendarColorSet(
  source: CalendarColorSource,
  dark: boolean,
): CalendarColorSet {
  const provided = parseHex(source.color);
  const base =
    provided ?? parseHex(CALENDAR_PALETTE[hashToIndex(source.id, CALENDAR_PALETTE.length)]!)!;

  const surface = dark ? SURFACE_DARK : SURFACE_LIGHT;
  const fill = mix(base, surface, dark ? 0.26 : 0.14);
  const border = mix(base, surface, dark ? 0.46 : 0.34);
  const text = readableInk(base, fill, dark);

  return {
    marker: toHex(base),
    fill: toHex(fill),
    border: toHex(border),
    text: toHex(text),
  };
}

/** Convenience for callers that only have the marker colour to show. */
export function calendarMarker(source: CalendarColorSource): string {
  const provided = parseHex(source.color);
  if (provided) return toHex(provided);
  return CALENDAR_PALETTE[hashToIndex(source.id, CALENDAR_PALETTE.length)]!;
}
