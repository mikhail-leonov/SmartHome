/**
 * Rules / automation engine — "what the SmartHome app decided to do."
 *
 * Evaluates declarative rules and invokes actors. Rules are triggered by:
 *   - state changes (every incoming MQTT message), plus a 1-minute sweep so
 *     duration- and time-of-day conditions are re-checked even without new
 *     messages,
 *   - cron schedules (per-rule),
 *   - seasonal boundaries.
 *
 * Every firing is run through the engine's runActor(), so it is logged and
 * persisted to actor_runs together with the triggering rule id.
 */
import { Cron } from 'croner';
import { config } from '../config/index.js';
import { bus } from '../core/bus.js';
import { state } from '../core/state.js';
import { logger } from '../core/logger.js';
import { runActor } from '../engine/index.js';
import { rules as defaultRules } from './rules.js';
import {
  BusEvents,
  type ActorPlugin,
  type Rule,
  type RuleContext,
  type Season,
  type StateValue,
} from '../types/types.js';

const memories = new Map<string, Record<string, unknown>>();
const crons: Cron[] = [];
let sweep: NodeJS.Timeout | null = null;

function memoryFor(ruleId: string): Record<string, unknown> {
  let m = memories.get(ruleId);
  if (!m) {
    m = {};
    memories.set(ruleId, m);
  }
  return m;
}

/** Evaluate a single rule and fire its actor if the condition holds. */
async function evaluate(
  rule: Rule,
  actors: Map<string, ActorPlugin>,
  trigger: RuleContext['trigger'],
): Promise<void> {
  let params: Record<string, unknown> | null | undefined;
  try {
    params = rule.evaluate({
      state: state.all(),
      config,
      trigger,
      memory: memoryFor(rule.id),
    });
  } catch (err) {
    logger.error('rules', `rule ${rule.id} evaluate() threw: ${(err as Error).message}`);
    return;
  }

  if (!params) return;

  const actor = actors.get(rule.actor);
  if (!actor) {
    logger.warn('rules', `rule ${rule.id} wants missing/disabled actor "${rule.actor}"`);
    return;
  }

  logger.info('rules', `✓ ${rule.id} fired → ${rule.actor}`);
  await runActor(actor, params, rule.id);
}

/** Start the rules engine with the loaded actors (and optional extra rules). */
export function startRules(actors: Map<string, ActorPlugin>, extra: Rule[] = []): void {
  const all = [...defaultRules, ...extra];
  logger.ok('rules', `loaded ${all.length} rule(s): ${all.map((r) => r.id).join(', ')}`);

  const stateRules = all.filter((r) => r.on.kind === 'state');
  const seasonRules = all.filter((r) => r.on.kind === 'season');
  const cronRules = all.filter((r) => r.on.kind === 'cron');

  // 1. State-driven rules: evaluate on every incoming state change.
  bus.on(BusEvents.StateChange, (rec: StateValue) => {
    for (const r of stateRules) {
      void evaluate(r, actors, { kind: 'state', topic: rec.topic });
    }
  });

  // 1b. Periodic sweep so duration/time-of-day conditions are re-checked.
  sweep = setInterval(() => {
    for (const r of stateRules) {
      void evaluate(r, actors, { kind: 'state' });
    }
  }, 60_000);
  sweep.unref?.();

  // 2. Season-driven rules.
  bus.on(BusEvents.SeasonChange, (season: Season) => {
    for (const r of seasonRules) {
      void evaluate(r, actors, { kind: 'season', season });
    }
  });

  // 3. Cron-driven rules.
  for (const r of cronRules) {
    if (!r.on.cron) continue;
    const job = new Cron(r.on.cron, () => void evaluate(r, actors, { kind: 'cron' }));
    crons.push(job);
    logger.info('rules', `scheduled ${r.id} @ "${r.on.cron}"`);
  }
}

export function stopRules(): void {
  if (sweep) clearInterval(sweep);
  for (const c of crons) c.stop();
}
