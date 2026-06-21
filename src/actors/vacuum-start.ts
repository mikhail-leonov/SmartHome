/**
 * Actor: vacuum-start
 *
 * Starts the robot vacuum by publishing a command to its .../set topic and
 * optimistically reflecting "cleaning" state on the dashboard.
 */
import type { ActorPlugin } from '../types/types.js';

const plugin: ActorPlugin = {
  id: 'vacuum-start',
  name: 'Start Vacuum',
  description: 'Starts the robot vacuum in the given room.',
  params: { room: 'string' },

  async execute(params, ctx) {
    const room = (params.room as string) || 'kitchen';
    const base = ctx.config.mqtt.baseTopic;
    ctx.mqtt.publish(`${base}/${room}/vacuum/set`, 'start');
    ctx.mqtt.publish(`${base}/${room}/vacuum/state`, 'cleaning');
    ctx.logger.info(`vacuum started in ${room}`);
  },
};

export default plugin;
