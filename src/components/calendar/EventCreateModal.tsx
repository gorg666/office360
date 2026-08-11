import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import type { DbCalendar } from "@/services/db/calendars";

interface EventCreateModalProps {
  calendars?: DbCalendar[];
  initialValues?: Partial<EventCreateInput>;
  onClose: () => void;
  onCreate: (event: EventCreateInput) => void | Promise<void>;
}

export interface EventCreateInput {
  summary: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  calendarId?: string;
}

export function EventCreateModal({ calendars, initialValues, onClose, onCreate }: EventCreateModalProps) {
  const [summary, setSummary] = useState(initialValues?.summary ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [location, setLocation] = useState(initialValues?.location ?? "");
  const [startTime, setStartTime] = useState(initialValues?.startTime ?? getDefaultStart());
  const [endTime, setEndTime] = useState(initialValues?.endTime ?? getDefaultEnd());
  const [attendees, setAttendees] = useState((initialValues?.attendees ?? []).join(", "));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState<string>(
    calendars?.find((c) => c.is_primary)?.id ?? calendars?.[0]?.id ?? "",
  );

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) return;

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      setError("Проверьте дату и время события.");
      return;
    }
    if (end <= start) {
      setError("Время окончания должно быть позже времени начала.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        summary: summary.trim(),
        description,
        location,
        startTime,
        endTime,
        attendees: parseAttendees(attendees),
        calendarId: calendarId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать событие.");
    } finally {
      setSubmitting(false);
    }
  }, [summary, description, location, startTime, endTime, attendees, calendarId, onCreate]);

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Event" width="w-full max-w-md">
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <TextField
          label="Title"
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Event title"
          autoFocus
        />

        {calendars && calendars.length > 1 && (
          <div>
            <label htmlFor="event-calendar" className="text-xs text-text-secondary block mb-1">Calendar</label>
            <select
              id="event-calendar"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent"
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.display_name ?? "Calendar"}
                  {cal.is_primary ? " (Primary)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Start"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <TextField
            label="End"
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>

        <TextField
          label="Location"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Add location"
        />

        <TextField
          label="Participants"
          type="text"
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          placeholder="name@example.com, colleague@example.com"
        />

        <div>
          <label className="text-xs text-text-secondary block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description"
            rows={3}
            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {error && (
            <div className="mr-auto max-w-[60%] text-xs text-danger">
              {error}
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={submitting || !summary.trim()}
          >
            {submitting ? "Создание..." : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function parseAttendees(value: string): string[] {
  return [...new Set(value.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

function getDefaultStart(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return toLocalISOString(now);
}

function getDefaultEnd(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 2);
  return toLocalISOString(now);
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
