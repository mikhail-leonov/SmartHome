/**
 * Open-Meteo integration.
 *
 * Free, key-less weather for the configured coordinates (default: Coral
 * Springs, FL). Non-commercial use is free up to ~10k calls/day; data is
 * CC BY 4.0 and requires attribution (rendered in the dashboard footer).
 *
 * Uses Node's built-in fetch (Node 18+) — no extra dependency. One GET returns
 * current conditions + today's daily summary; we normalize it into a flat
 * snapshot the weather sensor mirrors onto home/<room>/<device>/* topics.
 *
 * API: https://open-meteo.com/en/docs
 */
import type { AppConfig } from '../types/types.js';

export interface WeatherSnapshot {
  temperature?: number;
  apparent?: number;
  humidity?: number;
  weatherCode?: number;
  condition?: string;
  isDay?: boolean;
  precipitation?: number; // current, in configured precip unit
  precipProbability?: number; // %
  cloud?: number; // %
  pressure?: number; // hPa
  wind?: number;
  windDir?: number; // degrees
  gust?: number;
  uvMax?: number; // today's max UV index
  high?: number; // today's max temp
  low?: number; // today's min temp
  sunrise?: string;
  sunset?: string;
  observedAt?: string; // model time of the current reading
}

/** WMO weather interpretation codes → human description. */
const WMO: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm',
};

export function describeWeather(code?: number): string | undefined {
  if (code === undefined) return undefined;
  return WMO[code] ?? `Code ${code}`;
}

/** The platform-canonical topic for a weather leaf, e.g. "home/weather/current/temperature". */
export function canonicalTopic(config: AppConfig, leaf: string): string {
  const { room, device } = config.weather;
  return `${config.mqtt.baseTopic}/${room}/${device}/${leaf}`;
}

export function buildUrl(config: AppConfig): string {
  const w = config.weather;
  const params = new URLSearchParams({
    latitude: String(w.latitude),
    longitude: String(w.longitude),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,' +
      'weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset',
    hourly: 'precipitation_probability',
    temperature_unit: w.tempUnit,
    wind_speed_unit: w.windUnit,
    precipitation_unit: w.precipUnit,
    timezone: w.timezone,
    forecast_days: '1',
  });
  return `${w.baseUrl}/v1/forecast?${params.toString()}`;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function firstOf<T>(a: unknown): T | undefined {
  return Array.isArray(a) && a.length ? (a[0] as T) : undefined;
}

/** Pick the hourly value for the current hour, falling back to the first entry. */
function currentHourly(hourly: any, key: string, currentTime?: string): number | undefined {
  const times: unknown = hourly?.time;
  const vals: unknown = hourly?.[key];
  if (!Array.isArray(times) || !Array.isArray(vals)) return undefined;
  if (currentTime) {
    const hour = currentTime.slice(0, 13); // YYYY-MM-DDTHH
    const idx = times.findIndex((t) => typeof t === 'string' && t.slice(0, 13) === hour);
    if (idx >= 0) return num(vals[idx]);
  }
  return num(vals[0]);
}

/** Fetch and normalize current weather. Throws on network/HTTP failure. */
export async function fetchWeather(config: AppConfig): Promise<WeatherSnapshot> {
  const url = buildUrl(config);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.weather.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SmartHome/1.0 (Open-Meteo client)' },
    });
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
    const j: any = await res.json();
    const cur = j.current ?? {};
    const daily = j.daily ?? {};
    const hourly = j.hourly ?? {};
    const code = num(cur.weather_code);

    return {
      temperature: num(cur.temperature_2m),
      apparent: num(cur.apparent_temperature),
      humidity: num(cur.relative_humidity_2m),
      weatherCode: code,
      condition: describeWeather(code),
      isDay: cur.is_day === 1 || cur.is_day === true,
      precipitation: num(cur.precipitation),
      precipProbability:
        currentHourly(hourly, 'precipitation_probability', cur.time) ??
        firstOf<number>(daily.precipitation_probability_max),
      cloud: num(cur.cloud_cover),
      pressure: num(cur.pressure_msl),
      wind: num(cur.wind_speed_10m),
      windDir: num(cur.wind_direction_10m),
      gust: num(cur.wind_gusts_10m),
      uvMax: firstOf<number>(daily.uv_index_max),
      high: firstOf<number>(daily.temperature_2m_max),
      low: firstOf<number>(daily.temperature_2m_min),
      sunrise: firstOf<string>(daily.sunrise),
      sunset: firstOf<string>(daily.sunset),
      observedAt: typeof cur.time === 'string' ? cur.time : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}
