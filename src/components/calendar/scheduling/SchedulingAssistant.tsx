import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  participantIdentityKey,
  sameParticipant,
  type ParticipantRef,
} from "@/services/calendar/domain";
import {
  createAccountSchedulingAssistant,
  type CandidateSlot,
  type GroupSchedulingRequest,
  type GroupSchedulingResult,
  type ParticipantRole,
  type SlotClassification,
} from "@/services/calendar/scheduling";
import type { AvailabilityReliability } from "@/services/calendar/freeBusy";
import {
  DEFAULT_GRANULARITY_SECONDS,
  GRANULARITY_OPTIONS,
  HOUR_COLUMN_PX,
  busyTypeLabel,
  calendarDayRange,
  candidateAtInstant,
  classificationLabel,
  dateTimeLocalFromUnix,
  formatSuggestionWhen,
  hourTicks,
  layoutInterval,
  mergeOutsideWorkingHoursBands,
  optionalBusyCaption,
  outsideHoursCaption,
  participantInitials,
  publicBusyIntervals,
  reliabilityCaption,
  roleLabel,
  rowShowsUnknownFill,
  unixAtOffset,
  unixFromDateTimeLocal,
} from "./schedulingView";

export type PlanMeetingFn = (request: GroupSchedulingRequest) => Promise<GroupSchedulingResult>;

export interface SchedulingParticipantInput {
  participant: ParticipantRef;
  role: ParticipantRole;
  isSelf?: boolean;
}

export interface SchedulingAssistantProps {
  accountId?: string | null;
  timeZone: string;
  startTime: string;
  endTime: string;
  participants: readonly SchedulingParticipantInput[];
  onSelectRange: (startTime: string, endTime: string) => void;
  planMeeting?: PlanMeetingFn;
  debounceMs?: number;
  nowUnix?: number;
}

const PATTERN_TENTATIVE =
  "repeating-linear-gradient(-45deg, transparent 0 4px, color-mix(in oklab, var(--color-warning) 40%, transparent) 4px 8px)";
const PATTERN_UNKNOWN =
  "repeating-linear-gradient(90deg, color-mix(in oklab, var(--color-text-tertiary) 32%, transparent) 0 6px, transparent 6px 12px)";
const PATTERN_OUTSIDE =
  "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklab, var(--color-text-tertiary) 22%, transparent) 5px 6px)";

export function SchedulingAssistant({
  accountId,
  timeZone,
  startTime,
  endTime,
  participants,
  onSelectRange,
  planMeeting,
  debounceMs = 200,
  nowUnix,
}: SchedulingAssistantProps) {
  const [roleOverrides, setRoleOverrides] = useState<Record<string, ParticipantRole>>({});
  const [viewAnchorUnix, setViewAnchorUnix] = useState<number | null>(null);
  const [granularitySeconds, setGranularitySeconds] = useState(DEFAULT_GRANULARITY_SECONDS);
  const [result, setResult] = useState<GroupSchedulingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const generationRef = useRef(0);
  const scrollerRefs = useRef<Array<HTMLDivElement | undefined>>([]);
  const eventDateKey = startTime.slice(0, 10);

  const startUnix = unixFromDateTimeLocal(startTime, timeZone);
  const endUnix = unixFromDateTimeLocal(endTime, timeZone);
  const durationSeconds = startUnix !== null && endUnix !== null ? endUnix - startUnix : 0;
  const eventDayUnix = startUnix ?? Math.floor(Date.now() / 1000);

  useEffect(() => {
    setViewAnchorUnix(eventDayUnix);
  }, [eventDateKey, eventDayUnix]);

  const resolvedAnchor = viewAnchorUnix ?? eventDayUnix;
  const range = useMemo(() => calendarDayRange(resolvedAnchor, timeZone), [resolvedAnchor, timeZone]);

  const effectiveParticipants = useMemo(() => (
    participants.map((entry) => {
      const key = participantIdentityKey(entry.participant);
      return { ...entry, role: roleOverrides[key] ?? entry.role };
    })
  ), [participants, roleOverrides]);

  const participantPlanKey = effectiveParticipants
    .map((entry) => `${participantIdentityKey(entry.participant)}:${entry.role}`)
    .join(",");

  useEffect(() => {
    const incoming = new Map(participants.map((entry) => [participantIdentityKey(entry.participant), entry.role]));
    setRoleOverrides((current) => {
      const next: Record<string, ParticipantRole> = {};
      for (const [key, role] of Object.entries(current)) {
        const authored = incoming.get(key);
        if (!authored) continue;
        if (authored !== role) continue;
        next[key] = role;
      }
      const same = Object.keys(next).length === Object.keys(current).length
        && Object.entries(next).every(([key, role]) => current[key] === role);
      return same ? current : next;
    });
  }, [participants]);

  const canQuery = effectiveParticipants.length > 0 && durationSeconds > 0 && Boolean(accountId || planMeeting);

  useEffect(() => {
    if (!canQuery) {
      generationRef.current += 1;
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }
    const generation = ++generationRef.current;
    const controller = new AbortController();
    const required = effectiveParticipants.filter((entry) => entry.role === "required").map((entry) => entry.participant);
    const optional = effectiveParticipants.filter((entry) => entry.role === "optional").map((entry) => entry.participant);
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const request: GroupSchedulingRequest = {
        requiredParticipants: required,
        optionalParticipants: optional,
        range,
        durationSeconds,
        timeZone,
        options: { granularitySeconds, signal: controller.signal },
      };
      const execute = planMeeting
        ?? (accountId
          ? (nextRequest: GroupSchedulingRequest) => createAccountSchedulingAssistant(accountId).planMeeting(nextRequest)
          : null);
      if (!execute) return;
      void execute(request)
        .then((next) => {
          if (generation !== generationRef.current) return;
          setResult(next);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || generation !== generationRef.current) return;
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить занятость");
          setResult(null);
        })
        .finally(() => {
          if (generation === generationRef.current) setLoading(false);
        });
    }, debounceMs);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    accountId,
    canQuery,
    debounceMs,
    durationSeconds,
    granularitySeconds,
    participantPlanKey,
    planMeeting,
    range.start,
    range.end,
    refreshNonce,
    timeZone,
  ]);

  const ticks = useMemo(() => hourTicks(range, timeZone), [range, timeZone]);
  const timelineWidth = Math.max(ticks.length, 1) * HOUR_COLUMN_PX;
  const selection = startUnix !== null && endUnix !== null
    ? layoutInterval({ start: startUnix, end: endUnix }, range)
    : null;
  const clock = nowUnix ?? Math.floor(Date.now() / 1000);

  const applySlot = useCallback((slot: CandidateSlot) => {
    onSelectRange(dateTimeLocalFromUnix(slot.start, timeZone), dateTimeLocalFromUnix(slot.end, timeZone));
  }, [onSelectRange, timeZone]);

  const onTimelineClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!result) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left + event.currentTarget.scrollLeft;
    const instant = unixAtOffset(offset, timelineWidth, range);
    const slot = candidateAtInstant(result.candidates, instant);
    if (slot) applySlot(slot);
  }, [applySlot, range, result, timelineWidth]);

  const goToday = useCallback(() => setViewAnchorUnix(clock), [clock]);
  const goPrev = useCallback(() => setViewAnchorUnix(range.start - 3600), [range.start]);
  const goNext = useCallback(() => setViewAnchorUnix(range.end + 60), [range.end]);

  const toggleRole = useCallback((participant: ParticipantRef) => {
    const key = participantIdentityKey(participant);
    setRoleOverrides((current) => {
      const existing = effectiveParticipants.find((entry) => participantIdentityKey(entry.participant) === key);
      const currentRole = current[key] ?? existing?.role ?? "required";
      return { ...current, [key]: currentRole === "required" ? "optional" : "required" };
    });
  }, [effectiveParticipants]);

  const retry = useCallback(() => setRefreshNonce((value) => value + 1), []);

  const setScroller = useCallback((index: number) => (node: HTMLDivElement | null) => {
    scrollerRefs.current[index] = node ?? undefined;
  }, []);

  const syncScroll = useCallback((source: HTMLDivElement) => {
    const left = source.scrollLeft;
    for (const node of scrollerRefs.current) {
      if (node && node !== source && node.scrollLeft !== left) node.scrollLeft = left;
    }
  }, []);

  if (effectiveParticipants.length === 0) {
    return (
      <section data-testid="scheduling-assistant" className="surface-raised rounded-card border border-separator p-4">
        <h3 className="text-section font-semibold text-ink-primary">Подбор времени</h3>
        <p data-testid="scheduling-empty" className="mt-2 text-sm text-text-secondary">
          Добавьте участников, чтобы посмотреть общее свободное время
        </p>
      </section>
    );
  }

  return (
    <section data-testid="scheduling-assistant" className="surface-raised rounded-card border border-separator">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-separator px-3 py-2">
        <div>
          <h3 className="text-section font-semibold text-ink-primary">Подбор времени</h3>
          <p className="text-caption text-ink-tertiary">Время: {timeZone}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="secondary" size="sm" icon={<ChevronLeft size={14} />} iconOnly aria-label="Предыдущий день" onClick={goPrev} />
          <Button type="button" variant="secondary" size="sm" onClick={goToday}>Сегодня</Button>
          <Button type="button" variant="secondary" size="sm" icon={<ChevronRight size={14} />} iconOnly aria-label="Следующий день" onClick={goNext} />
          <label className="ml-2 flex items-center gap-1 text-xs text-text-secondary">
            Шаг
            <select
              className="focus-ring rounded-control border border-outline bg-surface-solid px-2 py-1 text-ink-primary"
              value={granularitySeconds}
              onChange={(event) => setGranularitySeconds(Number(event.target.value))}
              aria-label="Шаг сетки"
            >
              {GRANULARITY_OPTIONS.map((value) => (
                <option key={value} value={value}>{value / 60} мин</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {durationSeconds <= 0 && (
        <p className="px-3 py-2 text-caption text-danger-text">Проверьте начало и окончание встречи.</p>
      )}

      {error && (
        <div data-testid="scheduling-error" className="flex items-center justify-between gap-2 px-3 py-2 text-meta text-danger-text" role="alert">
          <span>{error}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void retry()}>Повторить</Button>
        </div>
      )}

      {loading && (
        <div data-testid="scheduling-loading" className="flex items-center gap-2 px-3 py-3 text-sm text-text-secondary" aria-busy="true">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          Загрузка занятости…
        </div>
      )}

      <div className="grid grid-cols-[minmax(8rem,11rem)_minmax(0,1fr)]">
        <div className="border-b border-separator px-3 py-2 text-caption font-semibold uppercase tracking-wider text-ink-tertiary">Участники</div>
        <div
          className="overflow-x-auto border-b border-separator"
          ref={setScroller(0)}
          onScroll={(event) => syncScroll(event.currentTarget)}
        >
          <div className="relative h-8" style={{ width: timelineWidth }} data-testid="scheduling-timeline-header">
            {ticks.map((tick) => {
              const laid = layoutInterval({ start: tick.unix, end: tick.unix + 60 }, range);
              if (!laid) return null;
              return (
                <span
                  key={tick.unix}
                  className="absolute top-1.5 text-caption tabular-nums text-ink-tertiary"
                  style={{ left: `${laid.leftPct}%` }}
                >
                  {tick.label}
                </span>
              );
            })}
          </div>
        </div>

        {effectiveParticipants.map((entry, index) => {
          const key = participantIdentityKey(entry.participant);
          const availability = result?.availability.find((item) =>
            participantIdentityKey(item.participant) === key
            || sameParticipant(item.participant, entry.participant),
          );
          const reliability = availability?.reliability ?? result?.participants.find((item) => item.identityKey === key)?.reliability ?? "unknown";
          return (
            <ParticipantAvailabilityRow
              key={key}
              name={entry.isSelf ? "Вы" : (entry.participant.displayName ?? entry.participant.value)}
              email={entry.isSelf ? undefined : (entry.participant.normalizedEmail ?? entry.participant.value)}
              role={entry.role}
              reliability={reliability}
              range={range}
              timelineWidth={timelineWidth}
              unknownFill={rowShowsUnknownFill(reliability)}
              busy={publicBusyIntervals(availability)}
              onToggleRole={() => toggleRole(entry.participant)}
              onTimelineClick={onTimelineClick}
              selection={selection}
              scrollerRef={setScroller(index + 1)}
              onScroll={syncScroll}
            />
          );
        })}

        <div className="surface-sunken border-t border-separator px-3 py-2">
          <p className="text-xs font-semibold text-text-primary">Все обязательные участники</p>
          <p className="text-[11px] text-text-tertiary">Сводка по обязательным</p>
        </div>
        <GroupAvailabilityRow
          range={range}
          timelineWidth={timelineWidth}
          segments={result?.segments ?? []}
          outsideHours={mergeOutsideWorkingHoursBands(result?.candidates ?? [])}
          selection={selection}
          onTimelineClick={onTimelineClick}
          scrollerRef={setScroller(effectiveParticipants.length + 1)}
          onScroll={syncScroll}
        />
      </div>

      {result?.workingHoursApplied && (
        <p className="border-t border-border-primary px-3 py-2 text-xs text-text-secondary">
          Учтены рабочие часы ({result.workingHoursPolicy === "require" ? "обязательно" : "предпочтительно"}).
          Вне рабочего времени показывается отдельно от занятости.
        </p>
      )}

      <SuggestedSlots
        suggestions={result?.suggestions ?? []}
        timeZone={timeZone}
        nowUnix={clock}
        onSelect={applySlot}
      />

      <Legend />
    </section>
  );
}

function ParticipantAvailabilityRow({
  name,
  email,
  role,
  reliability,
  range,
  timelineWidth,
  unknownFill,
  busy,
  onToggleRole,
  onTimelineClick,
  selection,
  scrollerRef,
  onScroll,
}: {
  name: string;
  email?: string;
  role: ParticipantRole;
  reliability: AvailabilityReliability;
  range: { start: number; end: number };
  timelineWidth: number;
  unknownFill: boolean;
  busy: ReturnType<typeof publicBusyIntervals>;
  onToggleRole: () => void;
  onTimelineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  selection: ReturnType<typeof layoutInterval>;
  scrollerRef: (node: HTMLDivElement | null) => void;
  onScroll: (source: HTMLDivElement) => void;
}) {
  const caption = reliabilityCaption(reliability);
  return (
    <>
      <div className="flex items-start gap-2 border-t border-border-primary px-3 py-2" data-testid="scheduling-participant">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-[11px] font-semibold text-text-secondary" aria-hidden>
          {participantInitials(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm text-text-primary">{name}</p>
          {email && <p className="truncate text-[11px] text-text-tertiary">{email}</p>}
          <button
            type="button"
            data-testid="scheduling-role"
            data-role={role}
            className={`mt-0.5 text-[11px] underline-offset-2 hover:underline ${role === "required" ? "text-text-secondary" : "text-text-tertiary"}`}
            onClick={onToggleRole}
            aria-label={`${name}: ${roleLabel(role)}. Переключить обязательность`}
          >
            {roleLabel(role)}
          </button>
          {caption && (
            <p className="text-[11px] text-warning" data-testid={`reliability-${reliability}`}>{caption}</p>
          )}
        </div>
      </div>
      <div
        className="overflow-x-auto border-t border-border-primary"
        ref={scrollerRef}
        onScroll={(event) => onScroll(event.currentTarget)}
      >
        <div
          className="relative h-12 bg-bg-primary"
          style={{ width: timelineWidth }}
          data-testid="scheduling-timeline"
          data-reliability={reliability}
          data-unknown={unknownFill ? "true" : "false"}
          onClick={onTimelineClick}
        >
          {unknownFill && (
            <div
              className="absolute inset-0 text-center text-[10px] leading-[3rem] text-text-tertiary"
              style={{ backgroundImage: PATTERN_UNKNOWN }}
              aria-hidden
            >
              ?
            </div>
          )}
          {busy.map((interval) => {
            const laid = layoutInterval(interval, range);
            if (!laid) return null;
            const tentative = interval.busyType === "tentative";
            return (
              <div
                key={`${interval.start}-${interval.end}-${interval.busyType}`}
                data-busy-type={interval.busyType}
                title={busyTypeLabel(interval.busyType)}
                aria-label={busyTypeLabel(interval.busyType)}
                className={`absolute top-1 bottom-1 rounded-sm ${tentative ? "bg-warning/40" : "bg-danger/70"}`}
                style={{
                  left: `${laid.leftPct}%`,
                  width: `${Math.max(laid.widthPct, 0.6)}%`,
                  backgroundImage: tentative ? PATTERN_TENTATIVE : undefined,
                }}
              />
            );
          })}
          <SelectionBlock selection={selection} />
        </div>
      </div>
    </>
  );
}

function GroupAvailabilityRow({
  range,
  timelineWidth,
  segments,
  outsideHours,
  selection,
  onTimelineClick,
  scrollerRef,
  onScroll,
}: {
  range: { start: number; end: number };
  timelineWidth: number;
  segments: GroupSchedulingResult["segments"];
  outsideHours: Array<{ start: number; end: number }>;
  selection: ReturnType<typeof layoutInterval>;
  onTimelineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  scrollerRef: (node: HTMLDivElement | null) => void;
  onScroll: (source: HTMLDivElement) => void;
}) {
  return (
    <div
      className="overflow-x-auto border-t border-border-primary bg-bg-tertiary"
      data-testid="scheduling-group-row"
      ref={scrollerRef}
      onScroll={(event) => onScroll(event.currentTarget)}
    >
      <div
        className="relative h-10"
        style={{ width: timelineWidth }}
        onClick={onTimelineClick}
        role="img"
        aria-label="Занятость всех обязательных участников"
      >
        {outsideHours.map((interval) => {
          const laid = layoutInterval(interval, range);
          if (!laid) return null;
          return (
            <div
              key={`hours-${interval.start}-${interval.end}`}
              data-testid="scheduling-outside-hours"
              aria-label="вне рабочего времени"
              title="вне рабочего времени"
              className="absolute top-1 bottom-1 border border-dashed border-border-primary"
              style={{
                left: `${laid.leftPct}%`,
                width: `${Math.max(laid.widthPct, 0.4)}%`,
                backgroundImage: PATTERN_OUTSIDE,
              }}
            />
          );
        })}
        {segments.map((segment) => {
          const laid = layoutInterval(segment, range);
          if (!laid) return null;
          return (
            <div
              key={`${segment.start}-${segment.end}`}
              data-testid="group-segment"
              data-classification={segment.classification}
              aria-label={classificationLabel(segment.classification)}
              title={classificationLabel(segment.classification)}
              className={`absolute top-1 bottom-1 ${groupClass(segment.classification)}`}
              style={{ left: `${laid.leftPct}%`, width: `${Math.max(laid.widthPct, 0.4)}%` }}
            />
          );
        })}
        <SelectionBlock selection={selection} />
      </div>
    </div>
  );
}

function SuggestedSlots({
  suggestions,
  timeZone,
  nowUnix,
  onSelect,
}: {
  suggestions: CandidateSlot[];
  timeZone: string;
  nowUnix: number;
  onSelect: (slot: CandidateSlot) => void;
}) {
  return (
    <div className="border-t border-border-primary px-3 py-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Подходящее время</h4>
      {suggestions.length === 0 ? (
        <p className="mt-2 text-sm text-text-secondary">Нет подходящих интервалов в выбранном дне.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {suggestions.map((slot) => (
            <li key={`${slot.start}-${slot.end}`}>
              <button
                type="button"
                data-testid="scheduling-suggestion"
                className="w-full rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-left hover:bg-bg-hover focus:border-accent focus:outline-none"
                onClick={() => onSelect(slot)}
              >
                <span className="block text-sm font-medium text-text-primary">
                  {formatSuggestionWhen(slot, timeZone, nowUnix)}
                </span>
                <span className="block text-xs text-text-secondary">{classificationLabel(slot.classification)}</span>
                {optionalBusyCaption(slot) && (
                  <span className="block text-xs text-warning">{optionalBusyCaption(slot)}</span>
                )}
                {outsideHoursCaption(slot) && (
                  <span className="block text-xs text-text-tertiary">{outsideHoursCaption(slot)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectionBlock({ selection }: { selection: ReturnType<typeof layoutInterval> }) {
  if (!selection) return null;
  return (
    <div
      data-testid="scheduling-selection"
      data-start={selection.start}
      data-end={selection.end}
      className="pointer-events-none absolute top-0 bottom-0 border border-accent bg-accent/20"
      style={{ left: `${selection.leftPct}%`, width: `${Math.max(selection.widthPct, 0.8)}%` }}
      aria-hidden
    />
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-3 border-t border-border-primary px-3 py-2 text-[11px] text-text-tertiary">
      <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm bg-danger/70" /> Занят</li>
      <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm bg-warning/40" style={{ backgroundImage: PATTERN_TENTATIVE }} /> Под вопросом</li>
      <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundImage: PATTERN_UNKNOWN }} /> Нет данных</li>
      <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm border border-dashed border-border-primary" style={{ backgroundImage: PATTERN_OUTSIDE }} /> Вне рабочего времени</li>
      <li className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm bg-success/30" /> Все обязательные свободны</li>
    </ul>
  );
}

function groupClass(classification: SlotClassification): string {
  switch (classification) {
    case "confirmed":
      return "bg-success/30";
    case "possible":
      return "bg-warning/25";
    case "unknown":
      return "bg-text-tertiary/25";
    case "blocked":
      return "bg-danger/25";
  }
}
