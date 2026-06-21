/**
 * Sensor: weekly-report
 *
 * Trigger: cron (Mondays at 08:00).
 * Aggregates the current state snapshot into a summary and publishes it to
 * home/system/weekly_report as a JSON object.
 */
import type { SensorPlugin } from '../types/types.js';

const plugin: SensorPlugin = {
  id: 'weekly-report',
  name: 'Weekly Report',
  trigger: { type: 'cron', expression: '0 8 * * 1' }, // Mon 08:00

  async run(ctx) {
    const snapshot = ctx.state.all();
    const topics = Object.values(snapshot);

    const rooms = new Set(topics.map((t) => t.room).filter(Boolean));
    const warmest = topics
      .filter((t) => t.device === 'ac' && t.variable === 'temperature')
      .map((t) => ({ room: t.room, temp: Number(t.value) }))
      .filter((t) => Number.isFinite(t.temp))
      .sort((a, b) => b.temp - a.temp)[0];

    const report = {
      generatedAt: new Date().toISOString(),
      trackedVariables: topics.length,
      activeRooms: rooms.size,
      warmestRoom: warmest ? `${warmest.room} (${warmest.temp}°C)` : 'n/a',
    };

    ctx.mqtt.publish(`${ctx.config.mqtt.baseTopic}/system/weekly_report`, report);
    ctx.logger.info(`weekly report published: ${report.trackedVariables} variables, ${report.activeRooms} rooms`);
  },
};

export default plugin;
