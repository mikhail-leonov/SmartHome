/**
 * Shared type contracts for the whole SmartHome platform.
 *
 * Every plugin (sensor or actor), the engine, the rules layer and the
 * web tier all conform to the interfaces declared here.
 */
import type { EventEmitter } from 'node:events';

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

/** A single variable's latest value plus when we last saw it. */
export interface StateValue {
  /** Full MQTT topic, e.g. "home/livingroom/ac/temperature". */
  topic: string;
  /** Parsed value (number/boolean/string/object). */
  value: unknown;
  /** Unit string for display, e.g. "°C". */
  unit?: string;
  /** Epoch millis of the last update. */
  updatedAt: number;
  /** Decomposed topic parts when the topic follows the home convention. */
  room?: string;
  device?: string;
  variable?: string;
}

/** Snapshot of every known variable, keyed by topic. */
export type StateSnapshot = Record<string, StateValue>;

// ─────────────────────────────────────────────────────────────
// Triggers & plugins
// ─────────────────────────────────────────────────────────────

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type Trigger =
  | { type: 'interval'; everyMs: number }
  | { type: 'cron'; expression: string }
  | { type: 'seasonal'; on: Season | 'any' }
  | { type: 'event'; topic?: string; eventName?: string };

/** Everything a plugin gets handed when it runs. */
export interface PluginContext {
  mqtt: { publish(topic: string, value: unknown, opts?: { retain?: boolean }): void };
  state: {
    get(topic: string): StateValue | undefined;
    all(): StateSnapshot;
  };
  bus: EventEmitter;
  logger: Console;
  config: AppConfig;
}

/** A sensor reads something and writes one or more MQTT variables. */
export interface SensorPlugin {
  id: string;
  name: string;
  room?: string;
  trigger: Trigger;
  run(ctx: PluginContext): Promise<void>;
}

/** Accepted parameter primitive kinds for an actor. */
export type ParamKind = 'string' | 'number' | 'boolean';

/** An actor performs an action when the rules engine decides to act. */
export interface ActorPlugin {
  id: string;
  name: string;
  description: string;
  params?: Record<string, ParamKind>;
  execute(params: Record<string, unknown>, ctx: PluginContext): Promise<void>;
}

export type PluginKind = 'sensor' | 'actor';

// ─────────────────────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────────────────────

/** A declarative automation rule: state/events → actor invocation. */
export interface Rule {
  id: string;
  description: string;
  /**
   * What the rule listens to. The engine evaluates the rule when any of
   * these fire. `'state'` = any state change; `'cron'` = on schedule;
   * `'season'` = on seasonal boundary.
   */
  on: { kind: 'state' | 'cron' | 'season'; cron?: string };
  /** The actor to run when the rule's condition holds. */
  actor: string;
  /**
   * Condition evaluated against the current snapshot. Return the params to
   * pass to the actor when it should fire, or null/undefined to skip.
   */
  evaluate(ctx: RuleContext): Record<string, unknown> | null | undefined;
}

/** Context handed to a rule's evaluate() function. */
export interface RuleContext {
  state: StateSnapshot;
  config: AppConfig;
  /** The event that triggered evaluation, when relevant. */
  trigger?: { kind: 'state' | 'cron' | 'season'; topic?: string; season?: Season };
  /** Per-rule scratch space that persists between evaluations. */
  memory: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

export interface VariableConfig {
  id: string;
  name: string;
  unit?: string;
}

export interface DeviceConfig {
  id: string;
  name: string;
  variables: VariableConfig[];
}

export interface RoomConfig {
  id: string;
  name: string;
  devices: DeviceConfig[];
}

export interface AppConfig {
  port: number;
  mqtt: {
    url: string;
    username?: string;
    password?: string;
    baseTopic: string;
  };
  db: {
    enabled: boolean;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  rules: {
    acTempThreshold: number;
    acTargetTemp: number;
    acSummerTarget: number;
    garageOpenGraceMinutes: number;
  };
  plugins: Record<string, boolean>;
  ytdlp: {
    feedUrl?: string;
    downloadDir: string;
  };
  /**
   * ratgdo bridge settings for the garage opener. The bridge subscribes to
   * `<ratgdoPrefix>/<doorName>/status/#` and mirrors state onto
   * `<baseTopic>/<room>/<device>/*`; commands go to
   * `<ratgdoPrefix>/<doorName>/command/*`.
   */
  garage: {
    enabled: boolean;
    ratgdoPrefix: string;
    doorName: string;
    room: string;
    device: string;
  };
  /**
   * Roomba (dorita980) local bridge. Credentials obtained via
   * `npx get-roomba-password <ip>`. The bridge mirrors robot telemetry onto
   * `<baseTopic>/<room>/<device>/*`.
   */
  roomba: {
    enabled: boolean;
    blid?: string;
    password?: string;
    host?: string;
    firmware: number;
    emitIntervalMs: number;
    room: string;
    device: string;
  };
  /**
   * Generic thermostat MQTT bridge. The Amazon Smart Thermostat has no local
   * API, so this consumes/produces topics under `prefix` that an external
   * Alexa→MQTT bridge provides, mirroring them onto `<baseTopic>/<room>/ac/*`.
   * `unit` is the unit the external thermostat speaks ('F' for Amazon).
   */
  thermostat: {
    enabled: boolean;
    room: string;
    prefix: string;
    unit: 'F' | 'C';
  };
  /**
   * Open-Meteo weather (free, no API key). Polled on an interval and mirrored
   * onto `<baseTopic>/<room>/<device>/*`. Units follow Open-Meteo's options.
   */
  weather: {
    enabled: boolean;
    latitude: number;
    longitude: number;
    locationName: string;
    baseUrl: string;
    tempUnit: 'celsius' | 'fahrenheit';
    windUnit: 'kmh' | 'mph' | 'ms' | 'kn';
    precipUnit: 'mm' | 'inch';
    timezone: string;
    refreshMinutes: number;
    timeoutMs: number;
    room: string;
    device: string;
  };
  rooms: RoomConfig[];
  projectRoot: string;
}

// ─────────────────────────────────────────────────────────────
// Internal event-bus names
// ─────────────────────────────────────────────────────────────

export const BusEvents = {
  /** Emitted for every incoming MQTT message: (StateValue). */
  StateChange: 'state:change',
  /** Emitted when the season scheduler crosses a boundary: (Season). */
  SeasonChange: 'season:change',
  /** Emitted when an actor finishes: (ActorRunRecord). */
  ActorRun: 'actor:run',
  /** Emitted when a sensor finishes a run: ({ id, ok, error? }). */
  SensorRun: 'sensor:run',
  /** Generic audit event for the dashboard activity log: (ActivityItem). */
  Activity: 'activity',
} as const;

/** A row in the dashboard activity log / WebSocket feed. */
export interface ActivityItem {
  kind: 'state' | 'actor' | 'sensor' | 'season' | 'system';
  message: string;
  detail?: string;
  at: number;
}

/** Record persisted for every actor execution. */
export interface ActorRunRecord {
  actorId: string;
  params: Record<string, unknown>;
  rule?: string;
  status: 'ok' | 'error';
  error?: string;
  at: number;
}
