/**
 * Actor: garage-close
 *
 * Closes the garage door by sending a real ratgdo command (.../command/door =
 * "close"). Kept as a distinct actor because the "garage-auto-close" rule
 * references it by id.
 *
 * Unlike the old version, it no longer fakes "home/garage/door/state = closed":
 * the actual state now comes back from the device via the garage-door bridge
 * sensor. It also refuses to close while the obstruction beam is broken.
 */
import type { ActorPlugin } from '../types/types.js';
import { canonicalTopic, commandTopic, isObstructed } from '../integrations/ratgdo.js';

const plugin: ActorPlugin = {
  id: 'garage-close',
  name: 'Close Garage',
  description: 'Closes the garage door (ratgdo command).',
  params: {},

  async execute(_params, ctx) {
    const obs = ctx.state.get(canonicalTopic(ctx.config, 'obstruction'))?.value;
    if (isObstructed(obs)) {
      ctx.logger.warn('garage-close: obstruction detected — aborting close');
      return;
    }
    ctx.mqtt.publish(commandTopic(ctx.config, 'door'), 'close', { retain: false });
    ctx.logger.info('garage door closing (ratgdo command sent)');
  },
};

export default plugin;
