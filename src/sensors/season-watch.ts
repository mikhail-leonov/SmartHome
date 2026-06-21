/**
 * Sensor: season-watch
 *
 * Trigger: seasonal (any boundary).
 * When the seasonal scheduler crosses a season boundary this sensor fires and
 * publishes the new season to home/system/season.
 */
import type { SensorPlugin } from '../types/types.js';
import { currentSeason } from '../engine/seasonal.js';

const plugin: SensorPlugin = {
  id: 'season-watch',
  name: 'Season Watch',
  trigger: { type: 'seasonal', on: 'any' },

  async run(ctx) {
    const season = currentSeason();
    ctx.mqtt.publish(`${ctx.config.mqtt.baseTopic}/system/season`, season);
    ctx.logger.info(`season is now "${season}"`);
  },
};

export default plugin;
