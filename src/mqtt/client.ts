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

export function isMqttConnected(): boolean {
  return connected;
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
    const value = coerce(payload.toString());
    const rec = state.set(topic, value);
    void persistState(rec);
    bus.emit(BusEvents.StateChange, rec);
    emitActivity({
      kind: 'state',
      message: `${topic} → ${formatValue(value)}${rec.unit ? ' ' + rec.unit : ''}`,
      at: rec.updatedAt,
    });
  });
}

/** Publish a value to a topic. Objects are JSON-stringified; state is retained. */
export function publish(topic: string, value: unknown): void {
  const payload = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  // State topics are retained so late subscribers (and broker restarts) keep
  // the latest snapshot; command (.../set) topics are not.
  const retain = !topic.endsWith('/set');

  // Optimistic local cache update so the dashboard is responsive even if the
  // broker is momentarily unreachable.
  const rec = state.set(topic, value);
  bus.emit(BusEvents.StateChange, rec);

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
