/**
 * Declarative automation rules.
 *
 * Each rule maps state/events → an actor invocation. The rules engine
 * (./index.ts) evaluates them. To add a new automation, append a Rule object
 * here (or import one from elsewhere) — this array is the registry, so it
 * doubles as the "rule plugin" extension point.
 *
 * `evaluate()` returns the params to hand the actor when it should fire, or
 * null/undefined to do nothing. `memory` is per-rule scratch space that
 * survives between evaluations (used here for timers and de-duplication).
 */
import type { Rule, StateValue } from '../types/types.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Find every "home/<room>/ac/temperature" entry in the snapshot. */
function acTemperatures(state: Record<string, StateValue>): { room: string; temp: number }[] {
  return Object.values(state)
    .filter((v) => v.device === 'ac' && v.variable === 'temperature')
    .map((v) => ({ room: v.room ?? 'unknown', temp: Number(v.value) }))
    .filter((x) => Number.isFinite(x.temp));
}

export const rules: Rule[] = [
  // ── 1. Auto-close the garage if left open late at night ──────────────
  {
    id: 'garage-auto-close',
    description: 'Close the garage if it stays open past 22:00 for too long',
    on: { kind: 'state' },
    actor: 'garage-close',
    evaluate({ state, config, memory }) {
      const door = state[`${config.mqtt.baseTopic}/garage/door/state`];
      const isOpen = door?.value === 'open' || door?.value === true;

      if (!isOpen) {
        memory.openSince = undefined;
        memory.firedFor = undefined;
        return null;
      }

      // Stamp the moment it opened.
      if (!memory.openSince) memory.openSince = door?.updatedAt ?? Date.now();

      const openSince = memory.openSince as number;
      const openMs = Date.now() - openSince;
      const graceMs = config.rules.garageOpenGraceMinutes * MINUTE;
      const lateHour = new Date().getHours() >= 22;

      // Fire once per "open session" to avoid hammering the actor.
      if (lateHour && openMs > graceMs && memory.firedFor !== openSince) {
        memory.firedFor = openSince;
        return { reason: 'open past 22:00', openMinutes: Math.round(openMs / MINUTE) };
      }
      return null;
    },
  },

  // ── 2. Cool a room whose AC temperature exceeds the threshold ────────
  {
    id: 'ac-high-temp',
    description: 'Lower the AC target when a room gets too warm',
    on: { kind: 'state' },
    actor: 'ac-set-temperature',
    evaluate({ state, config, memory }) {
      const hot = (memory.hot as Record<string, boolean>) ?? {};
      memory.hot = hot;

      for (const { room, temp } of acTemperatures(state)) {
        if (temp > config.rules.acTempThreshold) {
          if (!hot[room]) {
            hot[room] = true; // mark so we don't re-fire while it's still hot
            return { room, target: config.rules.acTargetTemp, observed: temp };
          }
        } else {
          hot[room] = false; // reset once it has cooled below threshold
        }
      }
      return null;
    },
  },

  // ── 3. Run the robot vacuum every day at 10:00 ───────────────────────
  {
    id: 'daily-vacuum',
    description: 'Start the robot vacuum daily at 10:00',
    on: { kind: 'cron', cron: '0 10 * * *' },
    actor: 'vacuum-start',
    evaluate() {
      return { room: 'kitchen' };
    },
  },

  // ── 4. Lower the default AC target when summer begins ────────────────
  {
    id: 'summer-ac',
    description: 'Lower the default AC target when summer starts',
    on: { kind: 'season' },
    actor: 'ac-set-temperature',
    evaluate({ config, trigger }) {
      if (trigger?.season === 'summer') {
        return { room: 'all', target: config.rules.acSummerTarget, reason: 'summer started' };
      }
      return null;
    },
  },
];

export default rules;
