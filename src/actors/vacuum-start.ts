/**
 * Actor: vacuum-start
 *
 * Starts a cleaning mission on the Roomba via the dorita980 bridge. Kept as a
 * distinct actor because the "daily-vacuum" rule references it by id.
 *
 * State is reported back by the robot through the vacuum bridge sensor, so we
 * no longer optimistically fake "cleaning".
 */
import type { ActorPlugin } from '../types/types.js';
import { sendCommand } from '../integrations/roomba.js';

const plugin: ActorPlugin = {
  id: 'vacuum-start',
  name: 'Start Vacuum',
  description: 'Starts a cleaning mission on the Roomba.',
  params: { room: 'string' },

  async execute(params, ctx) {
    const room = (params.room as string) || ctx.config.roomba.room;
    await sendCommand(ctx.config, 'start');
    ctx.logger.info(`vacuum start requested (${room})`);
  },
};

export default plugin;
