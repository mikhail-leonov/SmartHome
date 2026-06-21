/**
 * Actor: garage-close
 *
 * Closes the garage door: sends the command to home/garage/door/set and
 * reflects the resulting closed state on home/garage/door/state.
 */
import type { ActorPlugin } from '../types/types.js';

const plugin: ActorPlugin = {
  id: 'garage-close',
  name: 'Close Garage',
  description: 'Closes the garage door.',
  params: {},

  async execute(_params, ctx) {
    const base = ctx.config.mqtt.baseTopic;
    ctx.mqtt.publish(`${base}/garage/door/set`, 'close');
    ctx.mqtt.publish(`${base}/garage/door/state`, 'closed');
    ctx.logger.info('garage door closing');
  },
};

export default plugin;
