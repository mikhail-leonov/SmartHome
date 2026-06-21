# SmartHome Automation Platform

You are extending an existing **Node.js + TypeScript** project (Express + Twig + Bootstrap 5, with a MySQL config already scaffolded in `src/config/index.ts`). Turn this skeleton into a working **Smart Home automation platform** driven by MQTT, with an auto-discovered plugin system, a scheduling/event engine, a rules engine, and a live web dashboard.

Keep the current stack. Do **not** introduce a different framework. Reuse `express`, `twig`, `picocolors`, `dotenv`, and the existing `mysql2`-style config. Clean up leftover boilerplate naming (`FB2 Manager`, `video_collection`, "Empty Node Type Script") and rebrand everything to **SmartHome**.

---

## 1. Core architecture

MQTT is the single source of truth for device/variable state.

- The app connects to an MQTT broker, **subscribes** to state topics, and keeps an **in-memory state cache** of every variable's latest value + timestamp.
- It **persists** every state change and every action to MySQL (history + audit trail).
- A live web dashboard reflects the in-memory state in real time over WebSockets.

**Topic convention** (document this and use it consistently):

```
home/<room>/<device>/<variable>        # state, published by sensors/devices (retained)
home/<room>/<device>/set               # commands, published by actors
```

Example: `home/livingroom/ac/temperature`, `home/garage/door/state`.

**Internal event bus**: a single Node `EventEmitter` that bridges three sources — incoming MQTT messages, scheduler ticks, and seasonal/calendar changes — so sensors, the rules engine, and the WebSocket layer can all react to the same stream.

---

## 2. Plugin system (yt-dlp style)

Plugins must be **drop-in and auto-discovered**, exactly like yt-dlp extractors: add a file to a directory and it registers itself at startup with zero central wiring. Each plugin exports a **manifest** describing what it is and how it triggers, plus its run function. The loader scans the directory, validates each manifest, logs what was loaded, and skips/reports broken plugins without crashing the app.

There are two plugin kinds, in two directories:

### `src/sensors/` — inputs (write state)

A sensor reads something and **updates one or more MQTT variables**. Each sensor declares a **trigger**:

- `interval` — run every N (e.g. *every 10 minutes*, *call the AC temperature every hour*)
- `cron` — cron expression (e.g. *every week*, a specific weekday/time)
- `seasonal` — fire on season/calendar boundaries (e.g. *summer started*)
- `event` — react to an MQTT topic or internal event (e.g. *garage door opened*)

When a sensor runs it publishes to the appropriate state topic(s).

### `src/actors/` — outputs (perform actions)

An actor **does something** when the rules engine decides to act: it publishes to a `.../set` command topic, calls an external API, or shells out to a binary. Each actor exposes an `execute(params)` entry point and declares the params it accepts.

Required example plugins (implement at least these as working stubs):

**Sensors**
- `ac-temperature` — `interval`, hourly; reads/queries an AC unit and publishes `home/<room>/ac/temperature`.
- `garage-door` — `event`; listens for the garage door opening and publishes `home/garage/door/state`.
- `weekly-report` — `cron`, weekly; aggregates state and publishes a summary variable.
- `season-watch` — `seasonal`; publishes `home/system/season` when the season changes.
- `yt-dlp-feed` (demonstrates the yt-dlp-style integration) — `interval`; checks a configured channel/playlist via `yt-dlp` and updates a "new content available" variable.

**Actors**
- `vacuum-start` — starts the robot vacuum.
- `garage-close` — closes the garage door.
- `ac-set-temperature` — lowers/sets the AC target temperature.
- `yt-dlp-download` — runs `yt-dlp` to download a URL passed in params (concrete yt-dlp actor).

---

## 3. Plugin contracts (TypeScript)

Define shared interfaces in `src/types/types.ts` and have every plugin conform. Sketch:

```ts
type Trigger =
  | { type: 'interval'; everyMs: number }
  | { type: 'cron'; expression: string }
  | { type: 'seasonal'; on: 'spring' | 'summer' | 'autumn' | 'winter' | 'any' }
  | { type: 'event'; topic?: string; eventName?: string };

interface PluginContext {
  mqtt: { publish(topic: string, value: unknown): void };
  state: { get(topic: string): StateValue | undefined; all(): StateSnapshot };
  bus: EventEmitter;
  logger: Console;
  config: AppConfig;
}

interface SensorPlugin {
  id: string;
  name: string;
  room?: string;
  trigger: Trigger;
  run(ctx: PluginContext): Promise<void>;
}

interface ActorPlugin {
  id: string;
  name: string;
  description: string;
  params?: Record<string, 'string' | 'number' | 'boolean'>;
  execute(params: Record<string, unknown>, ctx: PluginContext): Promise<void>;
}
```

Build a `PluginLoader` that imports every file in `src/sensors` and `src/actors`, registers them, and wires each sensor's trigger to the engine.

---

## 4. Scheduling & trigger engine (`src/engine/`)

- Use a cron library (e.g. `node-cron` or `croner`) for `cron` triggers and `setInterval` for `interval` triggers.
- Implement a **seasonal** scheduler that computes season boundaries and emits an event when crossing one (so `seasonal` sensors fire).
- For `event` triggers, subscribe the sensor to its MQTT topic or named internal event.
- Every sensor execution and every actor execution is logged and persisted.

---

## 5. Rules / automation engine (`src/automation/`)

This is "what the Smart Home app decided to do." It maps **state + events → actor invocations**. Support declarative rules (JSON/config) evaluated whenever relevant state changes, plus the ability to add rule plugins.

Implement these example rules:

- If `home/garage/door/state == "open"` for more than 5 minutes after 22:00 → run `garage-close`.
- If any room AC `temperature` exceeds a configured threshold → run `ac-set-temperature` to lower it.
- Daily at 10:00 → run `vacuum-start`.
- When `season == "summer"` begins → lower the default AC target.

Each rule evaluation that fires an actor must be recorded (which rule, which actor, params, result).

---

## 6. MQTT integration (`src/mqtt/`)

- Use the `mqtt` npm package. Connection params come from config/env.
- On connect: subscribe to `home/#`, update the in-memory cache on every message, persist to MySQL, and re-emit on the internal bus.
- Provide a thin publish helper used by sensors and actors.
- Include broker settings so it works against a local **Mosquitto** instance out of the box.

---

## 7. Web UI / dashboard (Twig + Bootstrap + WebSockets)

Replace the placeholder `index.twig` "hero" content with a real dashboard:

- **One card/section per room**, each listing that room's variables with current value, unit, and "last updated" time. Rooms come from config.
- **Live updates** via WebSocket (`ws` or `socket.io`) — values change in place, no refresh. Stale variables visually flagged.
- A **system panel** for non-room variables (season, online status).
- An **activity log** panel showing recent state changes and actor runs (rule → actor → result), newest first.
- Keep Bootstrap 5, the existing layout/header partials, and the icon/font setup.

---

## 8. Persistence (`src/sql/schema.sql`)

Fill in the empty schema. At minimum:

- `variables` — current value per topic (room, device, variable, value, unit, updated_at).
- `variable_history` — append-only state-change log.
- `events` — bus/event audit.
- `actor_runs` — actor id, params, triggering rule, status, error, timestamp.
- `plugins` — registry of discovered plugins (id, kind, enabled).

Provide a small init script to create the schema.

---

## 9. Config & env

Extend `src/config/index.ts` and `.env.example` with:

- MQTT: `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, base topic prefix.
- Rooms definition (rooms and their expected devices/variables) — file or env-driven.
- Per-plugin enable/disable flags.
- Keep existing `PORT` and `DB_*` vars; fix the inconsistent default port between `index.ts` (3000) and config (3080) — pick one.

---

## 10. Deliverables & acceptance criteria

- `npm run dev` starts the server, connects to MQTT, auto-loads all sensor/actor plugins (logged with picocolors), and serves the dashboard.
- Publishing a test message to `home/<room>/<device>/<variable>` updates the dashboard live.
- The hourly AC sensor and the event-driven garage sensor both update their variables.
- Triggering the garage-open or high-temperature condition causes the rules engine to invoke the correct actor, visible in the activity log and `actor_runs`.
- Adding a new file to `src/sensors/` or `src/actors/` registers it automatically with no other code changes.
- A short `README.md` documenting the topic convention, the plugin contract, how to add a plugin, and how to run a local broker.

Provide clean, typed, well-commented code. Include `package.json` updates for every new dependency.