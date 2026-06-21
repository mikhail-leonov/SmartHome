/**
 * Actor: garage-lock
 *
 * Engages/disengages the opener's remote lockout via ratgdo
 * (.../command/lock). State is reported back through the bridge sensor.
 */
import type { ActorPlugin } from '../types/types.js';
import { commandTopic } from '../integrations/ratgdo.js';

const VALID = new Set(['lock', 'unlock']);

const plugin: ActorPlugin = {
  id: 'garage-lock',
  name: 'Garage Lock',
  description: 'Locks or unlocks the garage opener remote lockout.',
  params: { command: 'string', door: 'string' },

  async execute(params, ctx) {
    const command = String(params.command ?? '').trim().toLowerCase();
    if (!VALID.has(command)) {
      throw new Error(`command must be one of lock, unlock (got "${command}")`);
    }
    const door = (params.door as string) || undefined;
    ctx.mqtt.publish(commandTopic(ctx.config, 'lock', door), command, { retain: false });
    ctx.logger.info(`garage lock → ${command}`);
  },
};

export default plugin;
