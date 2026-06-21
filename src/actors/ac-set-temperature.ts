/**
 * Actor: ac-set-temperature
 *
 * Sets/lowers the AC target temperature for a room, or for every AC room when
 * room === "all". Publishes the command to .../ac/set and reflects the new
 * target on .../ac/target.
 */
import type { ActorPlugin } from '../types/types.js';

const plugin: ActorPlugin = {
  id: 'ac-set-temperature',
  name: 'Set AC Temperature',
  description: 'Sets the AC target temperature for a room (or all rooms).',
  params: { room: 'string', target: 'number' },

  async execute(params, ctx) {
    const base = ctx.config.mqtt.baseTopic;
    const target = Number(params.target ?? ctx.config.rules.acTargetTemp);
    const roomParam = (params.room as string) || 'all';

    const rooms =
      roomParam === 'all'
        ? ctx.config.rooms.filter((r) => r.devices.some((d) => d.id === 'ac')).map((r) => r.id)
        : [roomParam];

    for (const room of rooms) {
      ctx.mqtt.publish(`${base}/${room}/ac/set`, target);
      ctx.mqtt.publish(`${base}/${room}/ac/target`, target);
      ctx.logger.info(`AC target for ${room} set to ${target}°C`);
    }
  },
};

export default plugin;
