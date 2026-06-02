/** Tiny timestamped logger so output is readable in `journalctl`/docker logs. */
type Level = "info" | "warn" | "error" | "debug";

function log(level: Level, message: string, ...rest: unknown[]): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] ${message}`;
  if (level === "error") console.error(line, ...rest);
  else if (level === "warn") console.warn(line, ...rest);
  else console.log(line, ...rest);
}

export const logger = {
  info: (msg: string, ...rest: unknown[]) => log("info", msg, ...rest),
  warn: (msg: string, ...rest: unknown[]) => log("warn", msg, ...rest),
  error: (msg: string, ...rest: unknown[]) => log("error", msg, ...rest),
  debug: (msg: string, ...rest: unknown[]) => {
    if (process.env.DEBUG) log("debug", msg, ...rest);
  },
};
