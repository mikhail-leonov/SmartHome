/**
 * Sensor: garage-door  (ratgdo bridge)
 *
 * Replaces the old "simulate-only" garage sensor with a real bridge to a
 * ratgdo board attached to your MyQ/Chamberlain/LiftMaster opener.
 *
 * It subscribes to every ratgdo status leaf (door, obstruction, light, lock,
 * motion, availability) on your broker and mirrors each into the platform's
 * canonical "home/garage/door/<variable>" topics — so the dashboard, the rules
 * engine and the database all see live, real hardware state with no other
 * changes. ratgdo retains its status messages, so on (re)connect we are primed
 * immediately; the interval trigger is just a reconnect/keepalive safety net.
 *
 * The dashboard's "Open garage" simulate button (bus event "garage:opened")
 * still works as a no-hardware fallback for demos.
 */
import type { PluginContext, SensorPlugin } from '../types/types.js';
import { subscribeRaw } from '../mqtt/client.js';
import {
  canonicalTopic,
  commandTopic,
  normalizeStatus,
  statusFilter,
} from '../integrations/ratgdo.js';

let wired = false;

function wire(ctx: PluginContext): void {
  if (wired) return;
  wired = true;

  const filter = statusFilter(ctx.config);
  subscribeRaw(filter, (topic, payload) => {
    const norm = normalizeStatus(topic, payload);
    if (!norm) return;
    // Mirror onto the canonical topic; publish() caches + emits StateChange,
    // which feeds the dashboard and re-evaluates the rules engine.
    ctx.mqtt.publish(canonicalTopic(ctx.config, norm.leaf), norm.value, { retain: true });
    ctx.logger.info(`ratgdo ${norm.leaf} → ${String(norm.value)}`);
  });

  ctx.logger.info(
    `bridging ${filter} → ${ctx.config.mqtt.baseTopic}/${ctx.config.garage.room}/${ctx.config.garage.device}/*`,
  );

  // No-hardware fallback so the dashboard "Open garage" button still does
  // something useful in a demo without a ratgdo present.
  ctx.bus.on('garage:opened', () => {
    ctx.mqtt.publish(canonicalTopic(ctx.config, 'state'), 'open', { retain: true });
    ctx.logger.info('simulated garage open (no hardware)');
  });
}

const plugin: SensorPlugin = {
  id: 'garage-door',
  name: 'Garage Door (ratgdo bridge)',
  room: 'garage',
  trigger: { type: 'interval', everyMs: 5 * 60 * 1000 },

  async run(ctx) {
    wire(ctx);
    // Recent ratgdo firmware re-broadcasts status on receiving a query; older
    // firmware ignores it harmlessly (we already have the retained values).
    ctx.mqtt.publish(commandTopic(ctx.config, 'query'), 'status', { retain: false });
  },
};

export default plugin;
