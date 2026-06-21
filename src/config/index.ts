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
    'garage-door': envBool('PLUGIN_GARAGE_DOOR', true),
    'weekly-report': envBool('PLUGIN_WEEKLY_REPORT', true),
    'season-watch': envBool('PLUGIN_SEASON_WATCH', true),
    'yt-dlp-feed': envBool('PLUGIN_YT_DLP_FEED', false),
    'vacuum-start': envBool('PLUGIN_VACUUM_START', true),
    'garage-close': envBool('PLUGIN_GARAGE_CLOSE', true),
    'ac-set-temperature': envBool('PLUGIN_AC_SET_TEMPERATURE', true),
    'yt-dlp-download': envBool('PLUGIN_YT_DLP_DOWNLOAD', true),
  },

  ytdlp: {
    feedUrl: env('YTDLP_FEED_URL') || undefined,
    downloadDir: env('YTDLP_DOWNLOAD_DIR', './downloads'),
  },

  rooms: loadRooms(),

  projectRoot,
};

export default config;
