/**
 * Tiny structured logger built on picocolors.
 *
 * Exposes a Console-compatible surface (info/warn/error/debug/log) so it
 * can be handed directly to plugins as `ctx.logger`.
 */
import pc from 'picocolors';

function ts(): string {
  return pc.dim(new Date().toISOString().slice(11, 19));
}

function tag(label: string, color: (s: string) => string): string {
  return color(`[${label}]`);
}

export const logger = {
  info(scope: string, ...args: unknown[]): void {
    console.log(ts(), tag('info', pc.cyan), pc.bold(scope), ...args);
  },
  warn(scope: string, ...args: unknown[]): void {
    console.warn(ts(), tag('warn', pc.yellow), pc.bold(scope), ...args);
  },
  error(scope: string, ...args: unknown[]): void {
    console.error(ts(), tag('err ', pc.red), pc.bold(scope), ...args);
  },
  debug(scope: string, ...args: unknown[]): void {
    if (process.env.DEBUG) {
      console.log(ts(), tag('dbg ', pc.magenta), pc.bold(scope), ...args);
    }
  },
  ok(scope: string, ...args: unknown[]): void {
    console.log(ts(), tag(' ok ', pc.green), pc.bold(scope), ...args);
  },
  banner(text: string): void {
    console.log(pc.green(pc.bold(`\n  ${text}\n`)));
  },
};

/**
 * A Console-shaped adapter for plugins. Plugin code calls logger.info(...)
 * etc.; we route everything through the styled logger with the plugin id
 * already bound as the scope.
 */
export function pluginLogger(scope: string): Console {
  const c = {
    log: (...a: unknown[]) => logger.info(scope, ...a),
    info: (...a: unknown[]) => logger.info(scope, ...a),
    warn: (...a: unknown[]) => logger.warn(scope, ...a),
    error: (...a: unknown[]) => logger.error(scope, ...a),
    debug: (...a: unknown[]) => logger.debug(scope, ...a),
  };
  // Fill the rest of the Console surface with no-ops so the type is satisfied.
  return new Proxy(c as unknown as Console, {
    get(target, prop) {
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop as string];
      return () => {};
    },
  });
}

export default logger;
