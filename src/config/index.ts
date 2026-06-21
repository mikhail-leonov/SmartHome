/**
 * Central application configuration.
 *
 * Reads from environment (via dotenv) and from config/rooms.json, then
 * exposes a single typed `config` object the rest of the app consumes.
 *
 * Port note: the original skeleton disagreed with itself (index.ts used
 * 3000, the config used 3080). We standardise on 3080 everywhere.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AppConfig, RoomConfig } from '../types/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');

function env(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

/** Load the room/device/variable layout from config/rooms.json. */
function loadRooms(): RoomConfig[] {
  try {
    const raw = readFileSync(resolve(projectRoot, 'config', 'rooms.json'), 'utf8');
    const parsed = JSON.parse(raw) as { rooms: RoomConfig[] };
    return parsed.rooms ?? [];
  } catch {
    return [];
  }
}

export const config: AppConfig = {
  port: envInt('PORT', 3080),

  mqtt: {
    url: env('MQTT_URL', 'mqtt://localhost:1883'),
    username: env('MQTT_USERNAME') || undefined,
    password: env('MQTT_PASSWORD') || undefined,
    baseTopic: env('MQTT_BASE_TOPIC', 'home'),
  },

  db: {
    enabled: envBool('DB_ENABLED', true),
    host: env('DB_HOST', 'localhost'),
    port: envInt('DB_PORT', 3306),
    user: env('DB_USER', 'root'),
    password: env('DB_PASSWORD', ''),
    database: env('DB_NAME', 'smarthome'),
  },

  rules: {
    acTempThreshold: envInt('AC_TEMP_THRESHOLD', 26),
    acTargetTemp: envInt('AC_TARGET_TEMP', 22),
    acSummerTarget: envInt('AC_SUMMER_TARGET', 21),
    garageOpenGraceMinutes: envInt('GARAGE_OPEN_GRACE_MINUTES', 5),
  },

  /**
   * Per-plugin enable flags, keyed by plugin id. The loader consults this
   * map; an absent key defaults to enabled.
   */
  plugins: {
    'ac-temperature': envBool('PLUGIN_AC_TEMPERATURE', true),
    'ac-thermostat': envBool('PLUGIN_AC_THERMOSTAT', true),
    'garage-door': envBool('PLUGIN_GARAGE_DOOR', true),
    'weather': envBool('PLUGIN_WEATHER', true),
    'weekly-report': envBool('PLUGIN_WEEKLY_REPORT', true),
    'season-watch': envBool('PLUGIN_SEASON_WATCH', true),
    'yt-dlp-feed': envBool('PLUGIN_YT_DLP_FEED', false),
    'vacuum': envBool('PLUGIN_VACUUM', true),
    'vacuum-start': envBool('PLUGIN_VACUUM_START', true),
    'vacuum-command': envBool('PLUGIN_VACUUM_COMMAND', true),
    'garage-close': envBool('PLUGIN_GARAGE_CLOSE', true),
    'garage-command': envBool('PLUGIN_GARAGE_COMMAND', true),
    'garage-light': envBool('PLUGIN_GARAGE_LIGHT', true),
    'garage-lock': envBool('PLUGIN_GARAGE_LOCK', true),
    'ac-set-temperature': envBool('PLUGIN_AC_SET_TEMPERATURE', true),
    'ac-set-mode': envBool('PLUGIN_AC_SET_MODE', true),
    'yt-dlp-download': envBool('PLUGIN_YT_DLP_DOWNLOAD', true),
  },

  ytdlp: {
    feedUrl: env('YTDLP_FEED_URL') || undefined,
    downloadDir: env('YTDLP_DOWNLOAD_DIR', './downloads'),
  },

  /**
   * ratgdo garage bridge. Default ratgdoPrefix is "ratgdo" (outside the home
   * tree) so the device's raw status topics don't pollute the home state
   * cache — the bridge mirrors them onto home/<room>/<device>/* instead.
   */
  garage: {
    enabled: envBool('GARAGE_ENABLED', true),
    ratgdoPrefix: env('GARAGE_RATGDO_PREFIX', 'ratgdo'),
    doorName: env('GARAGE_DOOR_NAME', 'garage'),
    room: env('GARAGE_ROOM', 'garage'),
    device: env('GARAGE_DEVICE', 'door'),
  },

  /**
   * Roomba dorita980 local bridge. Get BLID/password with
   * `npx get-roomba-password <robot-ip>`. Disabled automatically if dorita980
   * isn't installed or the credentials are absent.
   */
  roomba: {
    enabled: envBool('ROOMBA_ENABLED', true),
    blid: env('ROOMBA_BLID') || undefined,
    password: env('ROOMBA_PASSWORD') || undefined,
    host: env('ROOMBA_HOST') || undefined,
    firmware: envInt('ROOMBA_FIRMWARE', 2),
    emitIntervalMs: envInt('ROOMBA_EMIT_INTERVAL_MS', 800),
    room: env('ROOMBA_ROOM', 'kitchen'),
    device: env('ROOMBA_DEVICE', 'vacuum'),
  },

  /**
   * Generic thermostat MQTT bridge. Disabled by default because the Amazon
   * Smart Thermostat has no local API — it needs an external Alexa→MQTT bridge
   * (Homebridge "Alexa Smart Home" plugin, or HA Alexa Devices integration)
   * publishing under THERMOSTAT_MQTT_PREFIX. unit = the thermostat's unit.
   */
  thermostat: {
    enabled: envBool('THERMOSTAT_ENABLED', false),
    room: env('THERMOSTAT_ROOM', 'livingroom'),
    prefix: env('THERMOSTAT_MQTT_PREFIX', 'alexa/thermostat'),
    unit: env('THERMOSTAT_UNIT', 'F').toUpperCase() === 'C' ? 'C' : 'F',
  },

  /**
   * Open-Meteo weather. Free, no API key. Defaults to Coral Springs, FL.
   * US-friendly units (°F / mph / inch) by default. CC BY 4.0 — attribution is
   * rendered in the dashboard footer.
   */
  weather: {
    enabled: envBool('WEATHER_ENABLED', true),
    latitude: envFloat('WEATHER_LAT', 26.2712),
    longitude: envFloat('WEATHER_LON', -80.2706),
    locationName: env('WEATHER_LOCATION', 'Coral Springs, FL'),
    baseUrl: env('WEATHER_BASE_URL', 'https://api.open-meteo.com'),
    tempUnit: env('WEATHER_TEMP_UNIT', 'fahrenheit') === 'celsius' ? 'celsius' : 'fahrenheit',
    windUnit: (['kmh', 'mph', 'ms', 'kn'] as const).includes(
      env('WEATHER_WIND_UNIT', 'mph') as any,
    )
      ? (env('WEATHER_WIND_UNIT', 'mph') as 'kmh' | 'mph' | 'ms' | 'kn')
      : 'mph',
    precipUnit: env('WEATHER_PRECIP_UNIT', 'inch') === 'mm' ? 'mm' : 'inch',
    timezone: env('WEATHER_TIMEZONE', 'America/New_York'),
    refreshMinutes: envInt('WEATHER_REFRESH_MINUTES', 15),
    timeoutMs: envInt('WEATHER_TIMEOUT_MS', 8000),
    room: env('WEATHER_ROOM', 'weather'),
    device: env('WEATHER_DEVICE', 'current'),
  },

  rooms: loadRooms(),

  projectRoot,
};

export default config;
