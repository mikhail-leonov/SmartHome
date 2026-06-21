/**
 * Actor: ac-set-mode
 *
 * Sets the thermostat mode (cool | heat | auto | off) through the external
 * Alexa→MQTT bridge, and reflects it on the canonical home/<room>/ac/mode
 * topic so the dashboard updates.
 */
import type { ActorPlugin } from '../types/types.js';
import { canonicalTopic, externalCommandTopic, normalizeMode } from '../integrations/thermostat.js';

const plugin: ActorPlugin = {
  id: 'ac-set-mode',
  name: 'Set AC Mode',
  description: 'Sets the thermostat mode: cool, heat, auto or off.',
  params: { mode: 'string' },

  async execute(params, ctx) {
    const mode = normalizeMode(String(params.mode ?? ''));
    if (!mode) {
      throw new Error(`mode must be one of cool, heat, auto, off (got "${params.mode}")`);
    }
    const th = ctx.config.thermostat;
    if (!th.enabled) {
      ctx.logger.warn('thermostat bridge disabled — mode change ignored');
      return;
    }
    ctx.mqtt.publish(externalCommandTopic(ctx.config, 'mode'), mode, { retain: false });
    ctx.mqtt.publish(canonicalTopic(ctx.config, 'mode'), mode, { retain: true });
    ctx.logger.info(`thermostat mode → ${mode}`);
  },
};

export default plugin;
