/**
 * ratgdo integration helper.
 *
 * MyQ/Chamberlain blocked third-party access to its cloud API in 2023 (and put
 * Cloudflare bot-protection on auth), so a direct MyQ cloud plugin is neither
 * reliable nor permitted. The robust, local alternative is a ratgdo board wired
 * to the opener's terminals, which exposes the door over plain MQTT:
 *
 *   <prefix>/<door>/status/door         open|closed|opening|closing|stopped
 *   <prefix>/<door>/status/obstruction  obstructed|clear
 *   <prefix>/<door>/status/light        on|off
 *   <prefix>/<door>/status/lock         locked|unlocked
 *   <prefix>/<door>/status/motion       detected|clear      (firmware-dependent)
 *   <prefix>/<door>/status/availability online|offline      (LWT)
 *
 *   <prefix>/<door>/command/door        open|close|stop
 *   <prefix>/<door>/command/light       on|off
 *   <prefix>/<door>/command/lock        lock|unlock
 *
 * This module owns the topic math and the mapping from ratgdo's status leaves
 * onto the platform's canonical "home/<room>/<device>/<variable>" topics, so the
 * bridge sensor and the command actors stay tiny.
 */
import type { AppConfig } from '../types/types.js';

export type DoorCommand = 'open' | 'close' | 'stop';
export type LightCommand = 'on' | 'off';
export type LockCommand = 'lock' | 'unlock';

/** "<prefix>/<door>" — the ratgdo device root. */
export function ratgdoBase(config: AppConfig, door?: string): string {
  const name = (door ?? config.garage.doorName).trim();
  return `${config.garage.ratgdoPrefix}/${name}`;
}

/** Wildcard filter covering every ratgdo status leaf for a door. */
export function statusFilter(config: AppConfig, door?: string): string {
  return `${ratgdoBase(config, door)}/status/#`;
}

/** A specific ratgdo command topic, e.g. ".../command/door". */
export function commandTopic(config: AppConfig, leaf: string, door?: string): string {
  return `${ratgdoBase(config, door)}/command/${leaf}`;
}

/** The platform-canonical topic a status leaf maps onto, e.g. "home/garage/door/state". */
export function canonicalTopic(config: AppConfig, leaf: string): string {
  const { room, device } = config.garage;
  return `${config.mqtt.baseTopic}/${room}/${device}/${leaf}`;
}

/** ratgdo status leaf → { canonical leaf, normalized value }. Unknown leaves are ignored. */
const STATUS_MAP: Record<string, (raw: string) => { leaf: string; value: unknown }> = {
  door: (raw) => ({ leaf: 'state', value: raw }),
  obstruction: (raw) => ({ leaf: 'obstruction', value: raw }),
  light: (raw) => ({ leaf: 'light', value: raw }),
  lock: (raw) => ({ leaf: 'lock', value: raw }),
  motion: (raw) => ({ leaf: 'motion', value: raw }),
  availability: (raw) => ({ leaf: 'online', value: raw === 'online' }),
};

export function normalizeStatus(
  topic: string,
  payload: string,
): { leaf: string; value: unknown } | null {
  const leaf = topic.split('/').pop() ?? '';
  const fn = STATUS_MAP[leaf];
  return fn ? fn(payload.trim()) : null;
}

/** True when the cached obstruction value means the beam is currently broken. */
export function isObstructed(value: unknown): boolean {
  return value === 'obstructed' || value === true;
}
