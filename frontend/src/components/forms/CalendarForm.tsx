import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { CalendarDays } from "lucide-react";

export function CalendarForm({ register, setValue, watch }: any) {
  return (
    <Section icon={<CalendarDays className="h-4 w-4" />} title="Calendar" sub="Parse public ICS calendars">
      <Field label="ICS URL" htmlFor="calendarUrl" required>
        <Input id="calendarUrl" {...register("calendarUrl", { required: true })} placeholder="https://example.com/calendar.ics" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Window Days" htmlFor="calendarWindowDays">
          <Input id="calendarWindowDays" type="number" {...register("calendarWindowDays", { valueAsNumber: true })} placeholder="30" />
        </Field>
        <Field label="Max Events" htmlFor="calendarMaxEvents">
          <Input id="calendarMaxEvents" type="number" {...register("calendarMaxEvents", { valueAsNumber: true })} placeholder="50" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={Boolean(watch("calendarIncludePastEvents"))} onCheckedChange={(v) => setValue("calendarIncludePastEvents", v === true)} />
        Include past events
      </label>
    </Section>
  );
}
