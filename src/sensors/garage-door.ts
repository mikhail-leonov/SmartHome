/**
 * Sensor: garage-door
 *
 * Trigger: event (internal bus event "garage:opened").
 * A hardware bridge — or the dashboard's "simulate" control — emits
 * `bus.emit('garage:opened')` when the physical door opener fires. This sensor
 * normalises that raw signal into the canonical state variable
 * home/garage/door/state = "open", which the rules engine then reacts to.
 *
 * (Closing is published by the garage-close actor, completing the loop.)
 */
import type { SensorPlugin } from '../types/types.js';

const plugin: SensorPlugin = {
  id: 'garage-door',
  name: 'Garage Door',
  room: 'garage',
  trigger: { type: 'event', eventName: 'garage:opened' },

  async run(ctx) {
    const topic = `${ctx.config.mqtt.baseTopic}/garage/door/state`;
    ctx.mqtt.publish(topic, 'open');
    ctx.logger.info('garage door opened → published state "open"');
  },
};

export default plugin;
