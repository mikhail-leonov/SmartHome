/**
 * Seasonal scheduler.
 *
 * Computes the current meteorological season (Northern Hemisphere) and emits
 * a SeasonChange event when a boundary is crossed. It checks periodically
 * (hourly) rather than computing exact astronomical instants — meteorological
 * seasons start on fixed month boundaries, so an hourly check reliably catches
 * the transition while keeping the implementation simple and dependency-free.
 */
import { bus } from '../core/bus.js';
import { logger } from '../core/logger.js';
import { BusEvents, type Season } from '../types/types.js';

/** Meteorological seasons (Northern Hemisphere): Dec–Feb winter, etc. */
export function seasonForDate(d: Date): Season {
  const m = d.getMonth(); // 0 = Jan
  if (m === 11 || m === 0 || m === 1) return 'winter';
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  return 'autumn';
}

let current: Season | null = null;
let timer: NodeJS.Timeout | null = null;

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function currentSeason(): Season {
  return current ?? seasonForDate(new Date());
}

function check(): void {
  const next = seasonForDate(new Date());
  if (next !== current) {
    const previous = current;
    current = next;
    if (previous !== null) {
      logger.info('season', `season changed: ${previous} → ${next}`);
      bus.emit(BusEvents.SeasonChange, next);
    }
  }
}

export function startSeasonScheduler(): void {
  current = seasonForDate(new Date());
  logger.ok('season', `current season: ${current}`);
  timer = setInterval(check, CHECK_INTERVAL_MS);
  // Don't keep the event loop alive solely for this check.
  timer.unref?.();
}

export function stopSeasonScheduler(): void {
  if (timer) clearInterval(timer);
}

/**
 * Test/ops helper: force a season transition (used by the dashboard's
 * "simulate" controls and handy for demos).
 */
export function forceSeason(season: Season): void {
  if (season === current) return;
  current = season;
  logger.info('season', `season forced → ${season}`);
  bus.emit(BusEvents.SeasonChange, season);
}
