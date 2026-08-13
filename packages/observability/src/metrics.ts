type Labels = Record<string, string>;

interface MetricDefinition {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
}

interface HistogramValue {
  buckets: number[];
  counts: number[];
  count: number;
  sum: number;
}

export class MetricsRegistry {
  private readonly definitions = new Map<string, MetricDefinition>();
  private readonly values = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramValue>();

  incrementCounter(name: string, help: string, labels: Labels = {}, amount = 1): void {
    if (amount < 0) throw new Error("Counters cannot be decremented.");
    this.define(name, help, "counter");
    const key = seriesKey(name, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  setGauge(name: string, help: string, labels: Labels = {}, value: number): void {
    this.define(name, help, "gauge");
    this.values.set(seriesKey(name, labels), finite(value));
  }

  incrementGauge(name: string, help: string, labels: Labels = {}, amount = 1): void {
    this.define(name, help, "gauge");
    const key = seriesKey(name, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  observeHistogram(
    name: string,
    help: string,
    labels: Labels,
    value: number,
    buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  ): void {
    this.define(name, help, "histogram");
    const key = seriesKey(name, labels);
    const histogram = this.histograms.get(key) ?? {
      buckets: [...buckets].sort((left, right) => left - right),
      counts: buckets.map(() => 0),
      count: 0,
      sum: 0,
    };
    const observation = finite(value);
    histogram.buckets.forEach((upper, index) => { if (observation <= upper) histogram.counts[index] += 1; });
    histogram.count += 1;
    histogram.sum += observation;
    this.histograms.set(key, histogram);
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const definition of [...this.definitions.values()].sort((left, right) => left.name.localeCompare(right.name))) {
      lines.push(`# HELP ${definition.name} ${escapeHelp(definition.help)}`);
      lines.push(`# TYPE ${definition.name} ${definition.type}`);
      if (definition.type === "histogram") {
        for (const [key, histogram] of this.seriesFor(this.histograms, definition.name)) {
          const labels = labelsFromKey(key);
          histogram.buckets.forEach((upper, index) => {
            lines.push(`${definition.name}_bucket${formatLabels({ ...labels, le: String(upper) })} ${histogram.counts[index]}`);
          });
          lines.push(`${definition.name}_bucket${formatLabels({ ...labels, le: "+Inf" })} ${histogram.count}`);
          lines.push(`${definition.name}_sum${formatLabels(labels)} ${histogram.sum}`);
          lines.push(`${definition.name}_count${formatLabels(labels)} ${histogram.count}`);
        }
      } else {
        for (const [key, value] of this.seriesFor(this.values, definition.name)) {
          lines.push(`${definition.name}${formatLabels(labelsFromKey(key))} ${value}`);
        }
      }
    }
    return `${lines.join("\n")}\n`;
  }

  private define(name: string, help: string, type: MetricDefinition["type"]): void {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error(`Invalid Prometheus metric name ${name}.`);
    const existing = this.definitions.get(name);
    if (existing && (existing.type !== type || existing.help !== help)) throw new Error(`Metric ${name} was redefined inconsistently.`);
    this.definitions.set(name, { name, help, type });
  }

  private seriesFor<T>(source: Map<string, T>, name: string): Array<[string, T]> {
    return [...source.entries()].filter(([key]) => key.startsWith(`${name}\u0000`)).sort(([left], [right]) => left.localeCompare(right));
  }
}

function seriesKey(name: string, labels: Labels): string {
  return `${name}\u0000${JSON.stringify(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)))}`;
}

function labelsFromKey(key: string): Labels {
  return Object.fromEntries(JSON.parse(key.slice(key.indexOf("\u0000") + 1)) as Array<[string, string]>);
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "";
  return `{${entries.map(([key, value]) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"')}"`).join(",")}}`;
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Metric values must be finite.");
  return value;
}

function escapeHelp(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}
