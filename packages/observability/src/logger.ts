export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LogSink = (line: string) => void;

const SENSITIVE_KEY = /authorization|token|password|secret|api[-_]?key|cookie/i;

export class StructuredLogger {
  constructor(
    private readonly service: string,
    private readonly sink: LogSink = (line) => console.log(line),
    private readonly now: () => Date = () => new Date(),
    private readonly minimumLevel: LogLevel = "INFO",
  ) {}

  debug(event: string, context: Record<string, unknown> = {}): void { this.write("DEBUG", event, context); }
  info(event: string, context: Record<string, unknown> = {}): void { this.write("INFO", event, context); }
  warn(event: string, context: Record<string, unknown> = {}): void { this.write("WARN", event, context); }
  error(event: string, context: Record<string, unknown> = {}): void { this.write("ERROR", event, context); }

  private write(level: LogLevel, event: string, context: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minimumLevel]) return;
    const sanitized = redact(context) as Record<string, unknown>;
    this.sink(JSON.stringify({
      timestamp: this.now().toISOString(),
      level,
      service: this.service,
      event,
      ...sanitized,
    }));
  }
}

const LEVEL_RANK: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  if (value instanceof Error) return { name: value.name, message: sanitizeText(value.message), stack: sanitizeText(value.stack ?? "") };
  if (typeof value === "string") return sanitizeText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry, seen)]));
}

function sanitizeText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/((?:token|password|secret|api[-_]?key)=)[^&\s]+/gi, "$1[REDACTED]");
}
