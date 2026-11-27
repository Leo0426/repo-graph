import { z } from 'zod';

const minute = 60_000;
const day = 24 * 60 * minute;
const scheduleZones = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
    const existing = scheduleZones.get(timeZone);
    if (existing) return existing;
    const created = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (scheduleZones.size >= 100) scheduleZones.delete(scheduleZones.keys().next().value!);
    scheduleZones.set(timeZone, created);
    return created;
}

export const calendarScheduleInput = z.object({
    timeZone: z.string().trim().max(100).regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/).refine(value => {
        try { formatter(value); return true; } catch { return false; }
    }),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z.array(z.int().min(0).max(6)).min(1).max(7).refine(values => values.length === new Set(values).size)
        .default([0, 1, 2, 3, 4, 5, 6])
}).strict();
export type CalendarSchedule = z.infer<typeof calendarScheduleInput>;
export const localTimeWindowInput = calendarScheduleInput.omit({ localTime: true }).extend({
    start: calendarScheduleInput.shape.localTime, end: calendarScheduleInput.shape.localTime
}).refine(window => window.start !== window.end);
export type LocalTimeWindow = z.infer<typeof localTimeWindowInput>;

function localMinute(format: Intl.DateTimeFormat, epoch: number) {
    const parts = Object.fromEntries(format.formatToParts(epoch).map(part => [part.type, Number(part.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

export function localTimeWindowOpen(window: LocalTimeWindow, at: number) {
    const clock = new Date(localMinute(formatter(window.timeZone), at));
    const time = clock.toISOString().slice(11, 16);
    const today = clock.getUTCDay();
    if (window.start < window.end) return window.weekdays.includes(today) && time >= window.start && time < window.end;
    return time >= window.start ? window.weekdays.includes(today)
        : time < window.end && window.weekdays.includes((today + 6) % 7);
}

export function nextCalendarOccurrence(schedule: CalendarSchedule, after: number) {
    const format = formatter(schedule.timeZone);
    const firstDay = Math.floor(localMinute(format, after) / day) * day;
    const [hour, min] = schedule.localTime.split(':').map(Number);
    const time = (hour * 60 + min) * minute;
    // A skipped weekly occurrence can defer the next eligible date by a second week.
    for (let date = firstDay; date <= firstDay + 14 * day; date += day) {
        if (!schedule.weekdays.includes(new Date(date).getUTCDay())) continue;
        const wall = date + time;
        const offsets = new Set([wall - 2 * day, wall, wall + 2 * day].map(sample => localMinute(format, sample) - sample));
        const valid = Array.from(offsets, offset => wall - offset).filter(epoch => localMinute(format, epoch) === wall);
        // The first occurrence wins on a repeated local minute. A missing minute skips the date.
        const earliest = Math.min(...valid);
        if (Number.isFinite(earliest) && earliest > after) return earliest;
    }
    throw new Error('No matching calendar occurrence');
}
