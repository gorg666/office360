import { ContactAvatar } from "@/components/ui/ContactAvatar";
import type { TaskPrincipalRef } from "@/services/tasks/domain";
import { personDisplayName } from "@/services/people/domain";

export function principalPrimaryLabel(principal: TaskPrincipalRef | null | undefined): string {
  if (!principal) return "не назначен";
  if (principal.person) return personDisplayName(principal.person);
  return principal.displayName?.trim() || principal.email || "не назначен";
}

export function TaskPersonCell({
  principal,
  compact = true,
}: {
  principal: TaskPrincipalRef | null | undefined;
  compact?: boolean;
}) {
  if (!principal) {
    return <span className="text-text-tertiary">не назначен</span>;
  }
  const name = principalPrimaryLabel(principal);
  const email = principal.email?.trim() || "";
  const title = principal.person?.jobTitle?.trim();
  const avatarClass = compact
    ? "w-5 h-5 text-[10px] shrink-0"
    : "w-7 h-7 text-xs shrink-0";

  return (
    <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
      {email ? (
        <ContactAvatar email={email} name={name} className={avatarClass} />
      ) : (
        <span
          className={`inline-flex items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary ${avatarClass}`}
          aria-hidden
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-text-primary text-xs">{name}</span>
        {!compact && email ? (
          <span className="block truncate text-[11px] text-text-tertiary">{email}</span>
        ) : null}
        {!compact && title ? (
          <span className="block truncate text-[11px] text-text-tertiary">{title}</span>
        ) : null}
      </span>
    </span>
  );
}
