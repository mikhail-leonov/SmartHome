/**
 * In-memory state cache — the live mirror of MQTT.
 *
 * MQTT is the source of truth; this cache is the latest snapshot of every
 * variable, kept hot in memory so the dashboard and rules engine never block
 * on the database. It is updated on every incoming MQTT message.
 */
import type { StateSnapshot, StateValue } from '../types/types.js';
import { config } from '../config/index.js';

const cache = new Map<string, StateValue>();

/**
 * Decompose "home/<room>/<device>/<variable>" into parts.
 * Returns undefined parts for topics that don't match the convention.
 */
export function parseTopic(topic: string): Pick<StateValue, 'room' | 'device' | 'variable'> {
  const parts = topic.split('/');
  if (parts[0] !== config.mqtt.baseTopic) return {};
  // home / room / device / variable
  return {
    room: parts[1],
    device: parts[2],
    variable: parts[3],
  };
}

/** Look up the configured unit for a topic, if the rooms config declares one. */
export function unitFor(room?: string, device?: string, variable?: string): string | undefined {
  if (!room || !device || !variable) return undefined;
  const r = config.rooms.find((x) => x.id === room);
  const d = r?.devices.find((x) => x.id === device);
  const v = d?.variables.find((x) => x.id === variable);
  return v?.unit || undefined;
}

/** Try to coerce a raw MQTT payload into a useful JS value. */
export function coerce(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const num = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(num)) return num;
  // Attempt JSON for objects/arrays.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  return trimmed;
}

export const state = {
  /** Update (or insert) the cache entry for a topic and return the record. */
  set(topic: string, value: unknown, updatedAt = Date.now()): StateValue {
    const parts = parseTopic(topic);
    const record: StateValue = {
      topic,
      value,
      unit: unitFor(parts.room, parts.device, parts.variable),
      updatedAt,
      ...parts,
    };
    cache.set(topic, record);
    return record;
  },

  get(topic: string): StateValue | undefined {
    return cache.get(topic);
  },

  /** Shallow copy of the whole cache keyed by topic. */
  all(): StateSnapshot {
    const out: StateSnapshot = {};
    for (const [k, v] of cache) out[k] = v;
    return out;
  },

  /** Every value for a given room. */
  byRoom(room: string): StateValue[] {
    return [...cache.values()].filter((v) => v.room === room);
  },

  size(): number {
    return cache.size;
  },
};

export default state;
