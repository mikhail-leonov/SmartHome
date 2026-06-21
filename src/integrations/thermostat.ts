/**
 * Thermostat integration (generic MQTT bridge).
 *
 * The Amazon Smart Thermostat has no local or official API — control only
 * happens through Amazon's cloud. So this module does NOT talk to the device
 * directly. Instead it bridges a *generic* MQTT thermostat: you run an
 * Alexa→MQTT bridge (Homebridge "Alexa Smart Home" plugin, or Home Assistant's
 * Alexa Devices integration exporting to MQTT) that publishes the thermostat's
 * readings and accepts setpoint/mode commands, and this maps those onto the
 * platform's canonical "home/<room>/ac/*" topics.
 *
 * External (bridge) contract — all under THERMOSTAT_MQTT_PREFIX:
 *   <prefix>/temperature   (state)   current ambient temperature
 *   <prefix>/setpoint      (state)   current target setpoint
 *   <prefix>/mode          (state)   cool | heat | auto | off
 *   <prefix>/set/setpoint  (command) we publish here to change the target
 *   <prefix>/set/mode      (command) we publish here to change the mode
 *
 * The same code works unchanged against any MQTT-speaking thermostat — so if
 * you later swap to a Matter/Zigbee/local-API unit, just repoint the prefix.
 */
import type { AppConfig } from '../types/types.js';

export type ThermostatMode = 'cool' | 'heat' | 'auto' | 'off';

/** Wildcard covering the external state leaves (but not the .../set/ subtree). */
export function externalStateFilter(config: AppConfig): string {
  return `${config.thermostat.prefix}/+`;
}

/** An external command topic, e.g. "alexa/thermostat/set/setpoint". */
export function externalCommandTopic(config: AppConfig, leaf: 'setpoint' | 'mode'): string {
  return `${config.thermostat.prefix}/set/${leaf}`;
}

/** The platform-canonical ac topic, e.g. "home/livingroom/ac/target". */
export function canonicalTopic(config: AppConfig, leaf: string): string {
  return `${config.mqtt.baseTopic}/${config.thermostat.room}/ac/${leaf}`;
}

// ── unit handling ───────────────────────────────────────────────────────
// The platform works in °C (rooms.json units, rule thresholds). The Amazon
// thermostat speaks °F. Convert at the boundary based on THERMOSTAT_UNIT.

function round(n: number, step: number): number {
  return Math.round(n / step) * step;
}

/** External reading → platform °C. */
export function toCelsius(config: AppConfig, value: number): number {
  if (config.thermostat.unit === 'C') return round(value, 0.5);
  return round(((value - 32) * 5) / 9, 0.5);
}

/** Platform °C → external unit (whole degrees for °F thermostats). */
export function fromCelsius(config: AppConfig, celsius: number): number {
  if (config.thermostat.unit === 'C') return round(celsius, 0.5);
  return Math.round((celsius * 9) / 5 + 32);
}

const MODE_ALIASES: Record<string, ThermostatMode> = {
  cool: 'cool',
  cooling: 'cool',
  heat: 'heat',
  heating: 'heat',
  auto: 'auto',
  automatic: 'auto',
  off: 'off',
};

export function normalizeMode(raw: string): ThermostatMode | null {
  return MODE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/** Map an incoming external state message onto a canonical leaf + value. */
export function mapIncoming(
  config: AppConfig,
  topic: string,
  payload: string,
): { leaf: string; value: unknown } | null {
  const leaf = topic.split('/').pop() ?? '';
  const raw = payload.trim();
  switch (leaf) {
    case 'temperature': {
      const n = Number(raw);
      return Number.isFinite(n) ? { leaf: 'temperature', value: toCelsius(config, n) } : null;
    }
    case 'setpoint': {
      const n = Number(raw);
      return Number.isFinite(n) ? { leaf: 'target', value: toCelsius(config, n) } : null;
    }
    case 'mode': {
      const m = normalizeMode(raw);
      return m ? { leaf: 'mode', value: m } : null;
    }
    default:
      return null; // ignore other leaves (incl. the set/ subtree)
  }
}
