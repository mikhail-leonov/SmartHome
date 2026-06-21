/**
 * Actor: garage-command
 *
 * Posts a door command (open | close | stop) to the ratgdo-bridged opener.
 * The resulting state is reported back by the device and arrives through the
 * garage-door bridge sensor — so we deliberately do NOT fake the state here.
 *
 * Safety: refuses to send "close" while the obstruction beam is broken.
 */
import type { ActorPlugin } from '../types/types.js';
import { canonicalTopic, commandTopic, isObstructed } from '../integrations/ratgdo.js';

const VALID = new Set(['open', 'close', 'stop']);

const plugin: ActorPlugin = {
  id: 'garage-command',
  name: 'Garage Door Command',
  description: 'Sends open/close/stop to the ratgdo-bridged garage door opener.',
  params: { command: 'string', door: 'string' },

  async execute(params, ctx) {
    const command = String(params.command ?? '').trim().toLowerCase();
    if (!VALID.has(command)) {
      throw new Error(`command must be one of open, close, stop (got "${command}")`);
    }
    const door = (params.door as string) || undefined;

    if (command === 'close') {
      const obs = ctx.state.get(canonicalTopic(ctx.config, 'obstruction'))?.value;
      if (isObstructed(obs)) {
        ctx.logger.warn('refusing to close: obstruction detected');
        return;
      }
    }

    ctx.mqtt.publish(commandTopic(ctx.config, 'door', door), command, { retain: false });
    ctx.logger.info(`garage door → ${command}${door ? ` (${door})` : ''}`);
  },
};

export default plugin;
