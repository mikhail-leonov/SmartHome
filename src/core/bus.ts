/**
 * The single internal event bus.
 *
 * One EventEmitter bridges three sources — incoming MQTT messages, scheduler
 * ticks, and seasonal/calendar changes — so sensors, the rules engine, and
 * the WebSocket layer can all subscribe to the same stream.
 *
 * Event names live in `BusEvents` (see types.ts).
 */
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();

// Many subscribers (every event sensor, the rules engine, the WS hub) listen
// to the same events, so lift the default cap.
bus.setMaxListeners(100);

export default bus;
