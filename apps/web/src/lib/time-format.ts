const DAILY_TIMEZONE = "UTC";

export function formatDailyCandleDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString("en-US", {
    timeZone: DAILY_TIMEZONE,
    month: "short",
    day: "numeric",
  });
}

export function formatIntradayCandleTime(timestampMs: number, timezone: string): string {
  return new Date(timestampMs).toLocaleString("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

export function isDailyGranularity(granularity: string): boolean {
  return granularity === "1Dutc";
}

export function defaultDisplayTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
