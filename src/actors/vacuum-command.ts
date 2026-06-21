/**
 * Actor: vacuum-command
 *
 * Sends any supported command to the Roomba via the dorita980 bridge:
 * start | stop | pause | resume | dock. The resulting state is reported back
 * by the robot through the vacuum bridge sensor, so we don't fake it here.
 */
import type { ActorPlugin } from '../types/types.js';
import { sendCommand, type VacuumCommand } from '../integrations/roomba.js';

const VALID = new Set<VacuumCommand>(['start', 'stop', 'pause', 'resume', 'dock']);

const plugin: ActorPlugin = {
  id: 'vacuum-command',
  name: 'Vacuum Command',
  description: 'Sends start/stop/pause/resume/dock to the Roomba.',
  params: { command: 'string', room: 'string' },

  async execute(params, ctx) {
    const command = String(params.command ?? '').trim().toLowerCase() as VacuumCommand;
    if (!VALID.has(command)) {
      throw new Error(`command must be one of start, stop, pause, resume, dock (got "${command}")`);
    }
    await sendCommand(ctx.config, command);
    ctx.logger.info(`vacuum → ${command}`);
  },
};

export default plugin;
