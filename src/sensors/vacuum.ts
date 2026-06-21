/**
 * Sensor: vacuum  (Roomba dorita980 bridge)
 *
 * Holds a persistent local connection to the Roomba (via the roomba
 * integration) and mirrors its telemetry onto the platform's canonical
 * "home/<room>/vacuum/<variable>" topics: state, phase, battery, bin, error.
 * The dashboard, rules engine and DB then see live robot state with no other
 * changes.
 *
 * The robot pushes updates on its own; the interval trigger is a reconnect
 * keepalive (the connection is re-established here if it dropped). Only changed
 * values are published, to avoid spamming MQTT/history with identical readings.
 */
import type { PluginContext, SensorPlugin } from '../types/types.js';
import { canonicalTopic, getRobot, onVacuumState, type VacuumSnapshot } from '../integrations/roomba.js';

let wired = false;

function wire(ctx: PluginContext): void {
  if (wired) return;
  wired = true;

  const prev: Record<string, unknown> = {};

  onVacuumState((s: VacuumSnapshot) => {
    const leaves: [string, unknown][] = [
      ['state', s.state],
      ['phase', s.phase],
      ['battery', s.battery],
      ['bin', s.bin],
      ['error', s.error],
    ];
    for (const [leaf, val] of leaves) {
      if (val === undefined || val === null) continue;
      if (prev[leaf] === val) continue;
      prev[leaf] = val;
      ctx.mqtt.publish(canonicalTopic(ctx.config, leaf), val, { retain: true });
    }
    ctx.logger.info(
      `roomba ${s.state ?? '?'}${s.battery !== undefined ? ` · ${s.battery}%` : ''}${
        s.error ? ` · err ${s.error}` : ''
      }`,
    );
  });

  ctx.logger.info(
    `bridging Roomba → ${ctx.config.mqtt.baseTopic}/${ctx.config.roomba.room}/${ctx.config.roomba.device}/*`,
  );
}

const plugin: SensorPlugin = {
  id: 'vacuum',
  name: 'Robot Vacuum (Roomba bridge)',
  room: 'kitchen',
  trigger: { type: 'interval', everyMs: 5 * 60 * 1000 },

  async run(ctx) {
    wire(ctx);
    // (Re)establish the local connection if it isn't up. Non-fatal if the robot
    // is offline or dorita980/credentials are missing — it just stays disabled.
    await getRobot(ctx.config);
  },
};

export default plugin;
