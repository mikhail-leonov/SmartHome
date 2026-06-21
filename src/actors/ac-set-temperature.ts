/**
 * Actor: ac-set-temperature
 *
 * Sets/lowers the AC target temperature for a room, or for every AC room when
 * room === "all". Publishes the command to .../ac/set and reflects the new
 * target on .../ac/target.
 *
 * When the thermostat bridge is enabled and the target room is the bridged one
 * (or "all"), it ALSO publishes the setpoint to the external Alexa→MQTT bridge
 * so the real thermostat actually changes. Target is converted from the
 * platform's °C to the thermostat's unit.
 */
import type { ActorPlugin } from '../types/types.js';
import { externalCommandTopic, fromCelsius } from '../integrations/thermostat.js';

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

    // Drive the real thermostat through the external bridge, if applicable.
    const th = ctx.config.thermostat;
    if (th.enabled && (roomParam === 'all' || roomParam === th.room)) {
      const ext = fromCelsius(ctx.config, target);
      ctx.mqtt.publish(externalCommandTopic(ctx.config, 'setpoint'), ext, { retain: false });
      ctx.logger.info(`thermostat setpoint → ${ext}°${th.unit}`);
    }
  },
};

export default plugin;
