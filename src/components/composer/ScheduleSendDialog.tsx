import { DateTimePickerDialog } from "@/components/ui/DateTimePickerDialog";

interface ScheduleSendDialogProps {
  onSchedule: (timestamp: number) => void;
  onClose: () => void;
}

function getSchedulePresets(): { label: string; detail: string; timestamp: number }[] {
  const now = new Date();
  const today = new Date(now);

  // Tomorrow morning 9am
  const tomorrowMorning = new Date(today);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);

  // Tomorrow afternoon 1pm
  const tomorrowAfternoon = new Date(today);
  tomorrowAfternoon.setDate(tomorrowAfternoon.getDate() + 1);
  tomorrowAfternoon.setHours(13, 0, 0, 0);

  // Monday morning 9am
  const monday = new Date(today);
  const dayOfWeek = monday.getDay();
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7 || 7;
  monday.setDate(monday.getDate() + daysUntilMonday);
  monday.setHours(9, 0, 0, 0);

  const dateFmt: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };

  return [
    {
      label: "Завтра утром",
      detail: `${tomorrowMorning.toLocaleDateString("ru-RU", dateFmt)}, 09:00`,
      timestamp: Math.floor(tomorrowMorning.getTime() / 1000),
    },
    {
      label: "Завтра днём",
      detail: `${tomorrowAfternoon.toLocaleDateString("ru-RU", dateFmt)}, 13:00`,
      timestamp: Math.floor(tomorrowAfternoon.getTime() / 1000),
    },
    {
      label: "В понедельник утром",
      detail: `${monday.toLocaleDateString("ru-RU", dateFmt)}, 09:00`,
      timestamp: Math.floor(monday.getTime() / 1000),
    },
  ];
}

export function ScheduleSendDialog({ onSchedule, onClose }: ScheduleSendDialogProps) {
  const presets = getSchedulePresets();

  return (
    <DateTimePickerDialog
      isOpen={true}
      onClose={onClose}
      title="Запланировать отправку"
      presets={presets}
      onSelect={onSchedule}
      submitLabel="Запланировать"
      zIndex="z-[60]"
    />
  );
}
