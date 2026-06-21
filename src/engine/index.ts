/**
 * Scheduling & trigger engine.
 *
 * Owns the shared PluginContext and turns each sensor's declared trigger into
 * a live schedule:
 *   - interval  → setInterval
 *   - cron      → croner
 *   - seasonal  → fires on the bus SeasonChange event
 *   - event     → fires on a matching MQTT topic (bus StateChange) or a
 *                 named internal bus event
 *
 * Every sensor and actor execution is logged and persisted.
 */
import { Cron } from 'croner';
import { config } from '../config/index.js';
import { bus } from '../core/bus.js';
import { state } from '../core/state.js';
import { logger, pluginLogger } from '../core/logger.js';
import { mqttFacade } from '../mqtt/client.js';
import { persistActorRun, persistEvent } from '../db/index.js';
import {
  BusEvents,
  type ActorPlugin,
  type ActorRunRecord,
  type PluginContext,
  type SensorPlugin,
  type Season,
  type StateValue,
} from '../types/types.js';

/** The shared context handed to every plugin run. */
export const pluginContext: PluginContext = {
  mqtt: mqttFacade,
  state: { get: (t) => state.get(t), all: () => state.all() },
  bus,
  logger: pluginLogger('plugin'),
  config,
};

const intervals: NodeJS.Timeout[] = [];
const crons: Cron[] = [];

/** Run one sensor, logging + persisting the outcome. */
export async function runSensor(sensor: SensorPlugin, reason: string): Promise<void> {
  const ctx: PluginContext = { ...pluginContext, logger: pluginLogger(sensor.id) };
  try {
    logger.info('engine', `▶ sensor ${sensor.id} (${reason})`);
    await sensor.run(ctx);
    bus.emit(BusEvents.SensorRun, { id: sensor.id, ok: true });
    void persistEvent('sensor:run', { id: sensor.id, reason, ok: true });
  } catch (err) {
    logger.error('engine', `sensor ${sensor.id} failed: ${(err as Error).message}`);
    bus.emit(BusEvents.SensorRun, { id: sensor.id, ok: false, error: (err as Error).message });
    void persistEvent('sensor:run', { id: sensor.id, reason, ok: false, error: (err as Error).message });
  }
}

/** Run one actor, logging + persisting an ActorRunRecord. Used by rules. */
export async function runActor(
  actor: ActorPlugin,
  params: Record<string, unknown>,
  rule?: string,
): Promise<ActorRunRecord> {
  const ctx: PluginContext = { ...pluginContext, logger: pluginLogger(actor.id) };
  const base = { actorId: actor.id, params, rule, at: Date.now() };
  try {
    logger.info('engine', `▷ actor ${actor.id}${rule ? ` (rule: ${rule})` : ''} ${JSON.stringify(params)}`);
    await actor.execute(params, ctx);
    const rec: ActorRunRecord = { ...base, status: 'ok' };
    bus.emit(BusEvents.ActorRun, rec);
    bus.emit(BusEvents.Activity, {
      kind: 'actor',
      message: `${rule ? rule + ' → ' : ''}${actor.id}: ok`,
      detail: JSON.stringify(params),
      at: rec.at,
    });
    void persistActorRun(rec);
    return rec;
  } catch (err) {
    const rec: ActorRunRecord = { ...base, status: 'error', error: (err as Error).message };
    logger.error('engine', `actor ${actor.id} failed: ${rec.error}`);
    bus.emit(BusEvents.ActorRun, rec);
    bus.emit(BusEvents.Activity, {
      kind: 'actor',
      message: `${rule ? rule + ' → ' : ''}${actor.id}: error`,
      detail: rec.error,
      at: rec.at,
    });
    void persistActorRun(rec);
    return rec;
  }
}

/** Match an MQTT topic against a subscription pattern with + and # wildcards. */
function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split('/');
  const t = topic.split('/');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '#') return true;
    if (p[i] === '+') continue;
    if (p[i] !== t[i]) return false;
  }
  return p.length === t.length;
}

/** Wire every sensor's trigger to the appropriate scheduler/subscription. */
export function wireSensors(sensors: SensorPlugin[]): void {
  for (const sensor of sensors) {
    const trig = sensor.trigger;
    switch (trig.type) {
      case 'interval': {
        // Fire once shortly after boot, then on the interval.
        setTimeout(() => void runSensor(sensor, 'interval:initial'), 2000).unref?.();
        const id = setInterval(() => void runSensor(sensor, 'interval'), trig.everyMs);
        id.unref?.();
        intervals.push(id);
        break;
      }
      case 'cron': {
        const job = new Cron(trig.expression, () => void runSensor(sensor, 'cron'));
        crons.push(job);
        break;
      }
      case 'seasonal': {
        bus.on(BusEvents.SeasonChange, (season: Season) => {
          if (trig.on === 'any' || trig.on === season) {
            void runSensor(sensor, `season:${season}`);
          }
        });
        break;
      }
      case 'event': {
        if (trig.topic) {
          bus.on(BusEvents.StateChange, (rec: StateValue) => {
            if (topicMatches(trig.topic!, rec.topic)) {
              void runSensor(sensor, `event:${rec.topic}`);
            }
          });
        }
        if (trig.eventName) {
          bus.on(trig.eventName, () => void runSensor(sensor, `event:${trig.eventName}`));
        }
        break;
      }
    }
  }
}

export function stopEngine(): void {
  for (const i of intervals) clearInterval(i);
  for (const c of crons) c.stop();
}
