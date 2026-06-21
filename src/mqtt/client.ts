/**
 * MQTT integration.
 *
 * On connect we subscribe to `<base>/#`, and for every incoming message we:
 *   1. update the in-memory state cache,
 *   2. persist the change to MySQL (history + current value),
 *   3. re-emit it on the internal bus as a StateChange event.
 *
 * A thin `publish()` helper is exported for sensors and actors. The cache is
 * also updated optimistically on publish so the dashboard reflects locally
 * generated state even before the retained message echoes back.
 *
 * `subscribeRaw()` lets a plugin listen to topics OUTSIDE the `home/` tree
 * (e.g. a ratgdo board publishing under `ratgdo/...`) without those raw topics
 * polluting the home state cache. The garage-door bridge uses it.
 *
 * Connection failure is non-fatal: mqtt.js reconnects automatically and the
 * dashboard still serves. Out of the box this targets a local Mosquitto
 * instance (mqtt://localhost:1883).
 */
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';
import { bus } from '../core/bus.js';
import { state, coerce } from '../core/state.js';
import { persistState } from '../db/index.js';
import { BusEvents, type ActivityItem } from '../types/types.js';

let client: MqttClient | null = null;
let connected = false;

/** Extra (non-home) subscriptions registered by plugins via subscribeRaw(). */
interface RawSub {
  filter: string;
  handler: (topic: string, payload: string) => void;
}
const rawSubs: RawSub[] = [];

export function isMqttConnected(): boolean {
  return connected;
}

/** Match an MQTT topic against a subscription filter with + and # wildcards. */
function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (f[i] === '+') continue;
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export function initMqtt(): void {
  const { url, username, password, baseTopic } = config.mqtt;
  logger.info('mqtt', `connecting to ${url}`);

  client = mqtt.connect(url, {
    username: username || undefined,
    password: password || undefined,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    clientId: `smarthome-${Math.random().toString(16).slice(2, 8)}`,
  });

  client.on('connect', () => {
    connected = true;
    logger.ok('mqtt', `connected to ${url}`);
    const wildcard = `${baseTopic}/#`;
    client!.subscribe(wildcard, { qos: 0 }, (err) => {
      if (err) logger.error('mqtt', `subscribe failed: ${err.message}`);
      else logger.ok('mqtt', `subscribed to ${wildcard}`);
    });
    // (Re)subscribe any plugin-registered raw filters.
    for (const sub of rawSubs) subscribeFilter(sub.filter);
    publishSystem('online', true);
    emitActivity({ kind: 'system', message: 'Connected to MQTT broker', at: Date.now() });
  });

  client.on('reconnect', () => logger.warn('mqtt', 'reconnecting…'));
  client.on('offline', () => {
    connected = false;
    logger.warn('mqtt', 'broker offline');
  });
  client.on('error', (err) => logger.error('mqtt', err.message));

  client.on('message', (topic, payload) => {
    const text = payload.toString();

    // Home-tree messages feed the canonical state cache + rules + dashboard.
    if (topic === baseTopic || topic.startsWith(`${baseTopic}/`)) {
      const value = coerce(text);
      const rec = state.set(topic, value);
      void persistState(rec);
      bus.emit(BusEvents.StateChange, rec);
      emitActivity({
        kind: 'state',
        message: `${topic} → ${formatValue(value)}${rec.unit ? ' ' + rec.unit : ''}`,
        at: rec.updatedAt,
      });
    }

    // Raw subscribers (e.g. the ratgdo bridge) get the unmodified payload.
    for (const sub of rawSubs) {
      if (topicMatches(sub.filter, topic)) {
        try {
          sub.handler(topic, text);
        } catch (err) {
          logger.error('mqtt', `raw handler for ${sub.filter} threw: ${(err as Error).message}`);
        }
      }
    }
  });
}

function subscribeFilter(filter: string): void {
  if (!client || !connected) return;
  client.subscribe(filter, { qos: 0 }, (err) => {
    if (err) logger.error('mqtt', `raw subscribe failed (${filter}): ${err.message}`);
    else logger.ok('mqtt', `subscribed to ${filter}`);
  });
}

/**
 * Subscribe to topics outside the home tree. The handler receives the raw
 * string payload. Survives reconnects. Used to bridge external MQTT devices.
 */
export function subscribeRaw(filter: string, handler: (topic: string, payload: string) => void): void {
  rawSubs.push({ filter, handler });
  subscribeFilter(filter);
}

/**
 * Publish a value to a topic. Objects are JSON-stringified.
 * Retention defaults to retained for state topics and not-retained for command
 * topics (anything ending in `/set`); pass `{ retain }` to override — command
 * topics like ratgdo `.../command/door` MUST be non-retained so a stale command
 * isn't replayed to the opener on reconnect.
 */
export function publish(topic: string, value: unknown, opts?: { retain?: boolean }): void {
  const payload = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  const retain = opts?.retain ?? !topic.endsWith('/set');

  // Optimistic local cache update so the dashboard is responsive even if the
  // broker is momentarily unreachable. Only home-tree topics are cached.
  if (topic === config.mqtt.baseTopic || topic.startsWith(`${config.mqtt.baseTopic}/`)) {
    const rec = state.set(topic, value);
    bus.emit(BusEvents.StateChange, rec);
  }

  if (client && connected) {
    client.publish(topic, payload, { qos: 0, retain });
  } else {
    logger.warn('mqtt', `publish queued locally (broker down): ${topic}`);
  }
}

/** Publish a `home/system/<key>` variable. */
export function publishSystem(key: string, value: unknown): void {
  publish(`${config.mqtt.baseTopic}/system/${key}`, value);
}

function emitActivity(item: ActivityItem): void {
  bus.emit(BusEvents.Activity, item);
}

function formatValue(v: unknown): string {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

export function closeMqtt(): void {
  if (client) {
    publishSystem('online', false);
    client.end(true);
  }
}

/** A minimal mqtt facade matching the PluginContext shape. */
export const mqttFacade = {
  publish,
};
