export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

export interface LogEvent {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

/** Default logger — writes JSON lines to stderr */
export const defaultLogger: Logger = {
  log(level, msg, meta) {
    const event: LogEvent = { ts: new Date().toISOString(), level, msg, ...meta };
    process.stderr.write(JSON.stringify(event) + "\n");
  },
};

/** No-op logger for testing */
export const noopLogger: Logger = {
  log() {},
};
