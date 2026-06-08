import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a time string like "08:00", "08:00:00", or "8:00" to "8:00 AM".
 */
export function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const parts = time.split(":");
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? "0", 10);
  if (isNaN(h)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}
