/**
 * Sensor: weather  (Open-Meteo)
 *
 * Trigger: interval (default every 15 min, plus once shortly after boot).
 * Fetches current conditions for the configured location and publishes them to
 * home/<room>/<device>/* (default home/weather/current/*). Only changed values
 * are published, to avoid churning the history table with identical readings.
 *
 * Network failures are non-fatal: they're logged and the platform keeps
 * running on the last good values. Requires outbound access to the Open-Meteo
 * host (default api.open-meteo.com) from wherever the platform runs.
 */
import type { PluginContext, SensorPlugin } from '../types/types.js';
import { BusEvents } from '../types/types.js';
import { config } from '../config/index.js';
import { canonicalTopic, fetchWeather, type WeatherSnapshot } from '../integrations/openmeteo.js';

const prev: Record<string, unknown> = {};

function publishChanged(ctx: PluginContext, leaf: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (prev[leaf] === value) return;
  prev[leaf] = value;
  ctx.mqtt.publish(canonicalTopic(ctx.config, leaf), value, { retain: true });
}

const plugin: SensorPlugin = {
  id: 'weather',
  name: 'Weather (Open-Meteo)',
  room: 'weather',
  trigger: { type: 'interval', everyMs: Math.max(1, config.weather.refreshMinutes) * 60 * 1000 },

  async run(ctx) {
    if (!ctx.config.weather.enabled) {
      ctx.logger.warn('WEATHER_ENABLED=false — weather sensor idle');
      return;
    }

    let w: WeatherSnapshot;
    try {
      w = await fetchWeather(ctx.config);
    } catch (err) {
      ctx.logger.warn(`open-meteo fetch failed: ${(err as Error).message}`);
      return;
    }

    const leaves: [string, unknown][] = [
      ['temperature', w.temperature],
      ['apparent', w.apparent],
      ['condition', w.condition],
      ['humidity', w.humidity],
      ['wind', w.wind],
      ['wind_dir', w.windDir],
      ['gust', w.gust],
      ['precip_prob', w.precipProbability],
      ['precipitation', w.precipitation],
      ['cloud', w.cloud],
      ['pressure', w.pressure],
      ['uv', w.uvMax],
      ['high', w.high],
      ['low', w.low],
      ['is_day', w.isDay],
      ['sunrise', w.sunrise],
      ['sunset', w.sunset],
      ['code', w.weatherCode],
    ];
    for (const [leaf, value] of leaves) publishChanged(ctx, leaf, value);

    const unit = ctx.config.weather.tempUnit === 'celsius' ? '°C' : '°F';
    ctx.logger.info(
      `${ctx.config.weather.locationName}: ${w.temperature ?? '?'}${unit}, ${w.condition ?? '?'}`,
    );

    // One tidy summary line in the activity feed (the per-leaf state echoes are
    // separate; this gives a human-readable headline).
    ctx.bus.emit(BusEvents.Activity, {
      kind: 'sensor',
      message: `Weather · ${w.temperature ?? '?'}${unit} ${w.condition ?? ''}`.trim(),
      detail: `feels ${w.apparent ?? '?'}${unit} · ${w.humidity ?? '?'}% RH · wind ${w.wind ?? '?'} · rain ${
        w.precipProbability ?? '?'
      }%`,
      at: Date.now(),
    });
  },
};

export default plugin;
