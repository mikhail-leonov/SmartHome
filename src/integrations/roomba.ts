/**
 * Roomba integration (dorita980 local bridge).
 *
 * iRobot has no broker-side MQTT you can subscribe to; the robot itself speaks
 * a single-connection TLS/MQTT protocol on the LAN. dorita980 is the de-facto
 * library for that. This module owns ONE persistent local connection to the
 * robot (the device only allows a single connection at a time), normalizes its
 * mission/state telemetry, and exposes simple command helpers. The bridge
 * sensor and the command actors build on it.
 *
 * Degrades gracefully, matching the platform's philosophy: if dorita980 isn't
 * installed, or the ROOMBA_* credentials are absent, or the robot is
 * unreachable, the bridge logs and disables itself — the app still boots.
 *
 * Setup:
 *   1. npm i dorita980
 *   2. get the BLID + password:  npx get-roomba-password <robot-ip>
 *      (close the iRobot app first; press HOME until it chimes when prompted)
 *   3. set ROOMBA_BLID / ROOMBA_PASSWORD / ROOMBA_HOST in .env
 *
 * Note: newer Node/OpenSSL disables legacy TLS renegotiation, which can break
 * local connections. dorita980 re-enables it when possible; if you still hit
 * TLS errors, try ROBOT_TLS_LEGACY / ROBOT_CIPHERS (see dorita980 docs).
 */
import type { AppConfig } from '../types/types.js';
import { logger } from '../core/logger.js';

export type VacuumCommand = 'start' | 'stop' | 'pause' | 'resume' | 'dock';

/** Normalized, dashboard-friendly view of the robot. All fields optional. */
export interface VacuumSnapshot {
  state?: string; // docked | cleaning | returning | paused | stopped | stuck | emptying | charging
  phase?: string; // raw Roomba phase (charge, run, hmUsrDock, …)
  battery?: number; // batPct
  bin?: string; // ok | full
  error?: number; // mission error code (0 = none)
}

/** The platform-canonical topic a vacuum leaf maps onto, e.g. "home/kitchen/vacuum/state". */
export function canonicalTopic(config: AppConfig, leaf: string): string {
  const { room, device } = config.roomba;
  return `${config.mqtt.baseTopic}/${room}/${device}/${leaf}`;
}

// ── connection singleton ────────────────────────────────────────────────
// dorita980 is an optional, untyped CJS dependency — kept as `any`.
let robot: any = null;
let connecting: Promise<any> | null = null;
let snapshot: VacuumSnapshot | null = null;
const listeners: ((s: VacuumSnapshot) => void)[] = [];

const PHASE_TO_STATE: Record<string, string> = {
  charge: 'charging',
  run: 'cleaning',
  stop: 'stopped',
  stuck: 'stuck',
  hmUsrDock: 'returning',
  hmMidMsn: 'returning',
  hmPostMsn: 'returning',
  dock: 'returning',
  evac: 'emptying',
  pause: 'paused',
};

function deriveState(cms: any): string | undefined {
  if (!cms) return undefined;
  const phase = cms.phase as string | undefined;
  const cycle = cms.cycle as string | undefined;
  if (phase === 'charge' && (!cycle || cycle === 'none')) return 'docked';
  return (phase && PHASE_TO_STATE[phase]) || phase;
}

/** Pull the useful bits out of a dorita980 `state`/`mission` payload. */
function normalize(reported: any): VacuumSnapshot {
  const cms = reported?.cleanMissionStatus;
  return {
    state: deriveState(cms),
    phase: cms?.phase,
    battery: typeof reported?.batPct === 'number' ? reported.batPct : undefined,
    bin: reported?.bin ? (reported.bin.full ? 'full' : 'ok') : undefined,
    error: typeof cms?.error === 'number' ? cms.error : undefined,
  };
}

/** Merge only the defined fields so a partial update never clobbers good values. */
function emit(partial: VacuumSnapshot): void {
  const merged: VacuumSnapshot = { ...(snapshot ?? {}) };
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined && v !== null) (merged as Record<string, unknown>)[k] = v;
  }
  snapshot = merged;
  for (const l of listeners) {
    try {
      l(snapshot);
    } catch (err) {
      logger.error('roomba', `state listener threw: ${(err as Error).message}`);
    }
  }
}

/** Subscribe to normalized state updates. Replays the latest snapshot immediately. */
export function onVacuumState(handler: (s: VacuumSnapshot) => void): void {
  listeners.push(handler);
  if (snapshot) handler(snapshot);
}

export function lastVacuum(): VacuumSnapshot | null {
  return snapshot;
}

async function loadLib(): Promise<any | null> {
  try {
    const mod: any = await import('dorita980');
    return mod.default ?? mod;
  } catch (err) {
    logger.warn(
      'roomba',
      `dorita980 not available (${(err as Error).message}) — vacuum bridge disabled. Run "npm i dorita980".`,
    );
    return null;
  }
}

/** Get (lazily establishing) the shared local connection, or null if unavailable. */
export async function getRobot(config: AppConfig): Promise<any | null> {
  if (robot) return robot;
  if (connecting) return connecting;

  const { enabled, blid, password, host, firmware, emitIntervalMs } = config.roomba;
  if (!enabled) return null;
  if (!blid || !password || !host) {
    logger.warn('roomba', 'ROOMBA_BLID/ROOMBA_PASSWORD/ROOMBA_HOST not set — vacuum bridge disabled');
    return null;
  }

  connecting = (async () => {
    const lib = await loadLib();
    if (!lib) {
      connecting = null;
      return null;
    }
    try {
      const r = new lib.Local(blid, password, host, firmware, emitIntervalMs);
      r.on('connect', () => logger.ok('roomba', `connected to robot @ ${host}`));
      r.on('close', () => {
        logger.warn('roomba', 'robot connection closed (will reconnect on next sweep)');
        robot = null;
        connecting = null;
      });
      r.on('error', (e: any) => logger.error('roomba', `robot error: ${e?.message ?? e}`));
      r.on('state', (data: any) => emit(normalize(data)));
      r.on('mission', (data: any) => emit(normalize(data)));
      robot = r;
      return r;
    } catch (err) {
      logger.error('roomba', `failed to connect: ${(err as Error).message}`);
      connecting = null;
      return null;
    }
  })();

  return connecting;
}

/** Send a command to the robot. Throws if the bridge is unavailable. */
export async function sendCommand(config: AppConfig, cmd: VacuumCommand): Promise<void> {
  const r = await getRobot(config);
  if (!r) throw new Error('vacuum bridge unavailable (check ROOMBA_* config / dorita980 install)');
  switch (cmd) {
    case 'start':
      await r.start();
      break;
    case 'stop':
      await r.stop();
      break;
    case 'pause':
      await r.pause();
      break;
    case 'resume':
      await r.resume();
      break;
    case 'dock':
      await r.dock();
      break;
  }
}

/** Close the connection (used on shutdown). */
export async function closeRobot(): Promise<void> {
  if (robot) {
    try {
      await robot.end();
    } catch {
      /* ignore */
    }
    robot = null;
    connecting = null;
  }
}
