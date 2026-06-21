/**
 * Sensor: ac-temperature
 *
 * Trigger: interval (hourly).
 * Queries each room's AC unit and publishes home/<room>/ac/temperature.
 *
 * This stub simulates a reading with a small random walk seeded from the last
 * cached value. Replace the body of read() with a real device/API call.
 *
 * When the thermostat bridge is enabled, this skips that room so the simulated
 * reading doesn't fight the real thermostat feed on the same topic.
 */
import type { SensorPlugin } from '../types/types.js';

function read(last: number | undefined): number {
  const base = typeof last === 'number' ? last : 23 + Math.random() * 3;
  const drift = (Math.random() - 0.45) * 1.5; // slight warm bias
  return Math.round((base + drift) * 10) / 10;
}

const plugin: SensorPlugin = {
  id: 'ac-temperature',
  name: 'AC Temperature',
  trigger: { type: 'interval', everyMs: 60 * 60 * 1000 }, // hourly

  async run(ctx) {
    const base = ctx.config.mqtt.baseTopic;
    const th = ctx.config.thermostat;
    const acRooms = ctx.config.rooms
      .filter((r) => r.devices.some((d) => d.id === 'ac'))
      .filter((r) => !(th.enabled && r.id === th.room)); // real thermostat owns its room

    if (acRooms.length === 0) {
      ctx.logger.warn('no simulated AC rooms (all configured or bridged)');
      return;
    }

    for (const room of acRooms) {
      const topic = `${base}/${room.id}/ac/temperature`;
      const last = ctx.state.get(topic)?.value as number | undefined;
      const temp = read(typeof last === 'number' ? last : undefined);
      ctx.mqtt.publish(topic, temp);
      ctx.logger.info(`${room.name} AC → ${temp}°C`);
    }
  },
};

export default plugin;
