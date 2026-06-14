import { CalendarDays, Check, ChevronDown, Clock, HelpCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { CalendarInvitationRsvpStatus, DbCalendarInvitation } from "@/services/db/calendarInvitations";

interface CalendarInviteCardProps {
  invitation: DbCalendarInvitation;
  onRespond: (invitationId: string, status: CalendarInvitationRsvpStatus) => Promise<void> | void;
  responding?: boolean;
}

const RSVP_LABELS: Record<CalendarInvitationRsvpStatus, string> = {
  needs_action: "Needs action",
  accepted: "Accepted",
  tentative: "Tentative",
  declined: "Declined",
};

export function CalendarInviteCard({ invitation, onRespond, responding = false }: CalendarInviteCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cancelled = invitation.status.toLowerCase() === "cancelled" || invitation.method === "CANCEL";
  const canRespond = !cancelled && invitation.rsvp_status === "needs_action";
  const processed = !cancelled && invitation.rsvp_status !== "needs_action";
  const timeText = formatInvitationTime(invitation);
  const queueText = queueStatusText(invitation);
  const deliveryText = processed
    ? processedDeliveryText(invitation)
    : queueText;

  return (
    <section
      className={`mx-6 mt-4 rounded-lg border border-border-primary bg-bg-secondary shadow-sm ${
        processed ? "p-3" : "p-4"
      }`}
    >
      <div className={`flex items-start gap-3 ${processed ? "items-center" : ""}`}>
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <CalendarDays size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 pr-2">
            <h2 className="truncate text-sm font-semibold text-text-primary" title={invitation.summary ?? undefined}>
              {invitation.summary || "Calendar invitation"}
            </h2>
            {cancelled && (
              <span className="rounded bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                Cancelled
              </span>
            )}
            {processed && (
              <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                {RSVP_LABELS[invitation.rsvp_status]}
              </span>
            )}
            {invitation.sequence > 0 && !cancelled && (
              <span className="rounded bg-bg-tertiary px-2 py-0.5 text-xs text-text-secondary">
                Update {invitation.sequence}
              </span>
            )}
          </div>

          {processed ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
                <span>{timeText}</span>
                {deliveryText && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{deliveryText}</span>
                  </>
                )}
              </div>

              {detailsOpen && (
                <InviteDetails
                  invitation={invitation}
                  timeText={timeText}
                  queueText={queueText}
                  compact
                />
              )}
            </>
          ) : (
            <InviteDetails
              invitation={invitation}
              timeText={timeText}
              queueText={queueText}
            />
          )}

          {canRespond && (
            <div className="mt-3 flex flex-wrap gap-2">
              <InviteActionButton
                label="Accept"
                title="Accept invitation"
                active={invitation.rsvp_status === "accepted"}
                disabled={responding}
                icon={<Check size={15} />}
                onClick={() => onRespond(invitation.id, "accepted")}
              />
              <InviteActionButton
                label="Tentative"
                title="Respond tentative"
                active={invitation.rsvp_status === "tentative"}
                disabled={responding}
                icon={<HelpCircle size={15} />}
                onClick={() => onRespond(invitation.id, "tentative")}
              />
              <InviteActionButton
                label="Decline"
                title="Decline invitation"
                active={invitation.rsvp_status === "declined"}
                disabled={responding}
                icon={<X size={15} />}
                onClick={() => onRespond(invitation.id, "declined")}
              />
            </div>
          )}
        </div>
        {processed && (
          <button
            type="button"
            aria-expanded={detailsOpen}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border-primary bg-bg-primary px-2 text-sm text-text-secondary hover:bg-bg-hover"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <span>{detailsOpen ? "Hide" : "Details"}</span>
            <ChevronDown
              size={15}
              aria-hidden="true"
              className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
    </section>
  );
}

function InviteDetails(props: {
  invitation: DbCalendarInvitation;
  timeText: string;
  queueText: string | null;
  compact?: boolean;
}) {
  const { invitation, timeText, queueText, compact = false } = props;

  return (
    <div className="mt-2 grid gap-1 text-sm text-text-secondary">
      {!compact && (
        <div className="flex items-center gap-2">
          <Clock size={14} aria-hidden="true" />
          <span>{timeText}</span>
        </div>
      )}
      {invitation.organizer_email && (
        <div className="truncate">Organizer: {invitation.organizer_email}</div>
      )}
      {invitation.location && (
        <div className="truncate">Location: {invitation.location}</div>
      )}
      {!compact && <div>RSVP: {RSVP_LABELS[invitation.rsvp_status]}</div>}
      {!compact && queueText && <div className="text-text-tertiary">{queueText}</div>}
      {invitation.timezone_id && invitation.timezone_warning !== 1 && (
        <div className="text-text-tertiary">Timezone: {invitation.timezone_id}</div>
      )}
      {invitation.timezone_warning === 1 && (
        <div className="flex items-center gap-2 text-warning">
          <HelpCircle size={14} aria-hidden="true" />
          <span>Timezone needs review: {invitation.timezone_id ?? "unknown"}</span>
        </div>
      )}
      {invitation.description && (
        <div className="line-clamp-2 text-text-tertiary">{invitation.description}</div>
      )}
    </div>
  );
}

function InviteActionButton(props: {
  label: string;
  title: string;
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors disabled:opacity-60 ${
        props.active
          ? "border-accent bg-accent text-white"
          : "border-border-primary bg-bg-primary text-text-primary hover:bg-bg-hover"
      }`}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function formatInvitationTime(invitation: DbCalendarInvitation): string {
  if (invitation.start_time <= 0) return "Time not specified";
  const start = new Date(invitation.start_time * 1000);
  const end = invitation.end_time > 0 ? new Date(invitation.end_time * 1000) : null;
  const dateOptions: Intl.DateTimeFormatOptions = invitation.is_all_day === 1
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" };
  const startText = start.toLocaleString(undefined, dateOptions);
  if (!end || invitation.is_all_day === 1) return startText;
  return `${startText} - ${end.toLocaleTimeString(undefined, { timeStyle: "short" })}`;
}

function queueStatusText(invitation: DbCalendarInvitation): string | null {
  switch (invitation.rsvp_queue_status) {
    case "queued":
      return "Response queued for delivery.";
    case "blocked":
      return "Response saved locally. Provider delivery is not available yet.";
    case "failed":
      return "Response saved locally. Delivery failed.";
    case "delivered":
      return "Response delivered.";
    default:
      return null;
  }
}

function processedDeliveryText(invitation: DbCalendarInvitation): string | null {
  switch (invitation.rsvp_queue_status) {
    case "queued":
      return "Delivery queued";
    case "blocked":
      return "Provider delivery unavailable";
    case "failed":
      return "Delivery failed";
    case "delivered":
      return "Delivered";
    default:
      return "Saved locally";
  }
}
