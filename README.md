# SmartHome

An MQTT-driven home-automation platform: an auto-discovered plugin system,
a scheduling/trigger engine, a declarative rules engine, and a live web
dashboard. Built on **Node.js + TypeScript**, **Express + Twig + Bootstrap 5**,
**mqtt.js**, **ws**, and **MySQL** (via `mysql2`).

MQTT is the single source of truth. The app subscribes to state topics, keeps
an in-memory cache of every variable, persists changes and actions to MySQL,
and pushes live updates to the dashboard over WebSockets.

---

## Quick start

```bash
npm install
cp .env.example .env          # adjust if your broker/DB differ

# 1. Start a local MQTT broker (see "Local broker" below)
# 2. (optional) create the MySQL schema:
npm run db:init

# 3. Run it
npm run dev                   # tsx watch, hot-reload
# or: npm run build && npm start
```

Then open **http://localhost:3080**.

Neither the broker nor MySQL is required to boot — if either is unreachable the
app logs a warning and runs on the in-memory cache, so the dashboard always
comes up. Persistence and real device messaging simply resume once they are
available.

---

## Topic convention

```
home/<room>/<device>/<variable>     # state — published by sensors/devices (retained)
home/<room>/<device>/set            # commands — published by actors (not retained)
home/system/<variable>              # non-room system variables (season, online, …)
```

Examples: `home/livingroom/ac/temperature`, `home/garage/door/state`,
`home/system/season`.

State topics are published **retained** so late subscribers and broker
restarts immediately see the latest value; `.../set` command topics are not
retained. The base prefix (`home`) is configurable via `MQTT_BASE_TOPIC`.

Try it with any MQTT client:

```bash
mosquitto_pub -t home/livingroom/ac/temperature -m 27.5 -r
# → the Living Room card updates live, and the high-temp rule fires ac-set-temperature
```

---

## Architecture

```
MQTT broker ──► mqtt/client ──► state cache (in-memory)
                    │                │
                    │                ├──► MySQL (variables, history, events, actor_runs)
                    ▼                ▼
              internal bus (single EventEmitter)
              ▲          │            │
   scheduler ─┘          ▼            ▼
   (interval/cron     rules engine   WebSocket hub ──► dashboard (Twig + Bootstrap)
    /seasonal)        (state+events
                       → actors)
```

- **`src/core/`** — logger (picocolors), the event bus, the state cache.
- **`src/mqtt/`** — broker connection, subscribe to `home/#`, publish helper.
- **`src/engine/`** — trigger wiring (interval/cron/seasonal/event) + the
  seasonal scheduler; runs sensors and actors with logging + persistence.
- **`src/plugins/loader.ts`** — yt-dlp-style auto-discovery.
- **`src/automation/`** — declarative rules and the evaluator.
- **`src/db/`** — MySQL persistence (degrades to no-op if unavailable).
- **`src/web/ws.ts`, `src/app.ts`** — WebSocket hub and Express/Twig server.

---

## Plugin system (yt-dlp style)

Plugins are **drop-in and auto-discovered**. Add a file to `src/sensors/` or
`src/actors/` and it registers itself at startup — no central wiring. The
loader scans the directory, validates each manifest, logs what loaded, and
skips broken plugins without crashing.

### Sensors — inputs (write state)

A sensor reads something and publishes one or more MQTT variables. It declares
a **trigger**:

| Trigger    | Shape                                             | Fires…                          |
|------------|---------------------------------------------------|---------------------------------|
| `interval` | `{ type:'interval', everyMs }`                    | every N ms (and once at boot)   |
| `cron`     | `{ type:'cron', expression }`                     | on a cron schedule (croner)     |
| `seasonal` | `{ type:'seasonal', on:'summer'｜'any'… }`        | on season boundaries            |
| `event`    | `{ type:'event', topic?, eventName? }`           | on a matching MQTT topic or bus event |

```ts
// src/sensors/my-sensor.ts
import type { SensorPlugin } from '../types/types.js';

const plugin: SensorPlugin = {
  id: 'my-sensor',
  name: 'My Sensor',
  trigger: { type: 'interval', everyMs: 60_000 },
  async run(ctx) {
    ctx.mqtt.publish(`${ctx.config.mqtt.baseTopic}/livingroom/lamp/state`, 'on');
  },
};
export default plugin;
```

### Actors — outputs (perform actions)

An actor does something when a rule decides to act: publish a `.../set`
command, call an API, or shell out to a binary. It declares the params it
accepts.

```ts
// src/actors/my-actor.ts
import type { ActorPlugin } from '../types/types.js';

const plugin: ActorPlugin = {
  id: 'my-actor',
  name: 'My Actor',
  description: 'Does the thing.',
  params: { room: 'string', target: 'number' },
  async execute(params, ctx) {
    ctx.mqtt.publish(`${ctx.config.mqtt.baseTopic}/${params.room}/ac/set`, params.target);
  },
};
export default plugin;
```

### The plugin context

Every plugin run receives a `PluginContext`:

```ts
interface PluginContext {
  mqtt: { publish(topic: string, value: unknown): void };
  state: { get(topic): StateValue | undefined; all(): StateSnapshot };
  bus: EventEmitter;
  logger: Console;     // routed through the styled picocolors logger
  config: AppConfig;
}
```

### Adding a plugin (the whole process)

1. Create a file in `src/sensors/` or `src/actors/`.
2. `export default` (or `export const plugin =`) an object matching
   `SensorPlugin` / `ActorPlugin`.
3. Save. That's it — restart `npm run dev` and it's discovered. Optionally add a
   `PLUGIN_<ID>` flag in `.env` to toggle it (absent = enabled).

Bundled examples: **sensors** `ac-temperature` (interval), `garage-door`
(event), `weekly-report` (cron), `season-watch` (seasonal), `yt-dlp-feed`
(interval, off by default); **actors** `vacuum-start`, `garage-close`,
`ac-set-temperature`, `yt-dlp-download`.

---

## Rules engine

Rules live in `src/automation/rules.ts` as an array — appending one is the
extension point. Each rule maps state/events to an actor invocation; every
firing is logged and written to `actor_runs` with the triggering rule id.

Bundled rules:

- **garage-auto-close** — garage open past 22:00 for more than
  `GARAGE_OPEN_GRACE_MINUTES` → `garage-close`.
- **ac-high-temp** — any room's AC above `AC_TEMP_THRESHOLD` →
  `ac-set-temperature` (to `AC_TARGET_TEMP`).
- **daily-vacuum** — every day at 10:00 → `vacuum-start`.
- **summer-ac** — when summer begins → lower the AC target to
  `AC_SUMMER_TARGET`.

---

## Dashboard

One card per room (each variable with value, unit, and last-updated time), a
system panel (season, MQTT/DB status, new-content flag), and a newest-first
activity log of state changes and actor runs. Values update in place over the
`/ws` WebSocket; stale variables are visually dimmed.

The **Simulate** toolbar exercises the platform without hardware: open the
garage (fires the event sensor → garage state → rules), push a hot living-room
temperature (fires the high-temp rule), or force a season change (fires the
seasonal sensor + summer rule).

---

## Local broker

Any MQTT broker works. **Mosquitto** out of the box:

```bash
# macOS
brew install mosquitto && brew services start mosquitto

# Debian/Ubuntu
sudo apt-get install mosquitto mosquitto-clients
sudo systemctl start mosquitto

# Docker
docker run -it --rm -p 1883:1883 eclipse-mosquitto
```

Default connection is `mqtt://localhost:1883` (override with `MQTT_URL`,
`MQTT_USERNAME`, `MQTT_PASSWORD`).

---

## Configuration

All settings come from `.env` (see `.env.example`): `PORT` (3080), the `MQTT_*`
block, the `DB_*` block (`DB_ENABLED=false` for memory-only mode), rules tuning
(`AC_TEMP_THRESHOLD`, `AC_TARGET_TEMP`, `AC_SUMMER_TARGET`,
`GARAGE_OPEN_GRACE_MINUTES`), per-plugin `PLUGIN_*` flags, and the `YTDLP_*`
options. Rooms/devices/variables are defined in `config/rooms.json`.

---

## Persistence

`npm run db:init` applies `src/sql/schema.sql`, creating the `smarthome`
database and tables: `variables` (current value per topic), `variable_history`
(append-only log), `events` (bus audit), `actor_runs` (actor id, params, rule,
status, error), and `plugins` (discovered registry).

---

## Scripts

| Script              | Does                                      |
|---------------------|-------------------------------------------|
| `npm run dev`       | Run with hot-reload (`tsx watch`)         |
| `npm run build`     | Compile TypeScript to `dist/`             |
| `npm start`         | Run the compiled build                    |
| `npm run typecheck` | Type-check without emitting               |
| `npm run db:init`   | Create the MySQL schema                   |

---

## License

MIT
