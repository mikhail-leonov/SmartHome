/**
 * Actor: garage-light
 *
 * Controls the opener's light via ratgdo (.../command/light). State is reported
 * back by the device through the garage-door bridge sensor.
 */
import type { ActorPlugin } from '../types/types.js';
import { commandTopic } from '../integrations/ratgdo.js';

const VALID = new Set(['on', 'off']);

const plugin: ActorPlugin = {
  id: 'garage-light',
  name: 'Garage Light',
  description: 'Turns the garage opener light on or off.',
  params: { command: 'string', door: 'string' },

  async execute(params, ctx) {
    const command = String(params.command ?? '').trim().toLowerCase();
    if (!VALID.has(command)) {
      throw new Error(`command must be one of on, off (got "${command}")`);
    }
    const door = (params.door as string) || undefined;
    ctx.mqtt.publish(commandTopic(ctx.config, 'light', door), command, { retain: false });
    ctx.logger.info(`garage light → ${command}`);
  },
};

export default plugin;
