/**
 * Sensor: ac-thermostat  (generic thermostat MQTT bridge)
 *
 * Subscribes to an external Alexa→MQTT thermostat bridge and mirrors its
 * readings onto the platform's canonical "home/<room>/ac/*" topics:
 *   <prefix>/temperature → home/<room>/ac/temperature (converted to °C)
 *   <prefix>/setpoint    → home/<room>/ac/target      (converted to °C)
 *   <prefix>/mode        → home/<room>/ac/mode        (cool|heat|auto|off)
 *
 * Disabled by default (THERMOSTAT_ENABLED=false) because it needs that
 * external bridge running. When enabled, also disable the simulated
 * ac-temperature sensor for this room so they don't fight over the topic
 * (the ac-temperature sensor already skips the thermostat room automatically).
 */
import type { PluginContext, SensorPlugin } from '../types/types.js';
import { subscribeRaw } from '../mqtt/client.js';
import { canonicalTopic, externalStateFilter, mapIncoming } from '../integrations/thermostat.js';

let wired = false;

function wire(ctx: PluginContext): void {
  if (wired) return;
  wired = true;

  const filter = externalStateFilter(ctx.config);
  subscribeRaw(filter, (topic, payload) => {
    const mapped = mapIncoming(ctx.config, topic, payload);
    if (!mapped) return;
    ctx.mqtt.publish(canonicalTopic(ctx.config, mapped.leaf), mapped.value, { retain: true });
    ctx.logger.info(`thermostat ${mapped.leaf} → ${String(mapped.value)}`);
  });

  ctx.logger.info(
    `bridging ${filter} → ${ctx.config.mqtt.baseTopic}/${ctx.config.thermostat.room}/ac/*`,
  );
}

const plugin: SensorPlugin = {
  id: 'ac-thermostat',
  name: 'Thermostat (MQTT bridge)',
  trigger: { type: 'interval', everyMs: 5 * 60 * 1000 },

  async run(ctx) {
    if (!ctx.config.thermostat.enabled) {
      ctx.logger.warn('THERMOSTAT_ENABLED=false — thermostat bridge idle');
      return;
    }
    wire(ctx);
  },
};

export default plugin;
