/**
 * Working-hours band used to shade the Week/Day time grid — DESIGN-001C.
 *
 * Purely presentational: it changes which rows get a recessive wash and nothing
 * about scheduling, availability, free/busy or event placement. Hours are local
 * to the grid's display time zone.
 */
export const WORKING_HOUR_START = 8;
export const WORKING_HOUR_END = 20;

export function isWorkingHour(hour: number): boolean {
  return hour >= WORKING_HOUR_START && hour < WORKING_HOUR_END;
}
