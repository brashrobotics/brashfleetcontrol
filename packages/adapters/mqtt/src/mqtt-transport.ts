import { connect as connectMqtt, type IClientOptions, type MqttClient } from "mqtt";

export type MqttQos = 0 | 1;
export type MqttConnectionState = "CONNECTED" | "RECONNECTING" | "OFFLINE" | "DISCONNECTED";

export interface MqttMessage {
  topic: string;
  payload: string;
  qos: MqttQos;
  retained: boolean;
}

export interface MqttPublishOptions {
  qos?: MqttQos;
  retain?: boolean;
}

export interface MqttSubscription {
  topic: string;
  qos?: MqttQos;
}

export type MqttMessageHandler = (message: MqttMessage) => void | Promise<void>;
export type MqttConnectionHandler = (state: MqttConnectionState) => void;

export interface MqttTransport {
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(topic: string, payload: string, options?: MqttPublishOptions): Promise<void>;
  subscribe(subscription: MqttSubscription): Promise<void>;
  onMessage(handler: MqttMessageHandler): () => void;
  onConnectionState(handler: MqttConnectionHandler): () => void;
}

export interface MqttWillMessage {
  topic: string;
  payload: string;
  qos: MqttQos;
  retain: boolean;
}

export interface MqttJsTransportOptions {
  brokerUrl: string;
  clientId: string;
  username?: string;
  password?: string;
  reconnectPeriodMs?: number;
  connectTimeoutMs?: number;
  keepaliveSeconds?: number;
  cleanSession?: boolean;
  will?: MqttWillMessage;
  onError?: (error: Error) => void;
}

/** MQTT 3.1.1 transport with mqtt.js automatic reconnect and resubscription. */
export class MqttJsTransport implements MqttTransport {
  private readonly messageHandlers = new Set<MqttMessageHandler>();
  private readonly connectionHandlers = new Set<MqttConnectionHandler>();
  private readonly onError: (error: Error) => void;
  private client: MqttClient | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly options: MqttJsTransportOptions) {
    assertBrokerUrl(options.brokerUrl);
    if (!options.clientId.trim()) throw new Error("MQTT clientId must not be empty.");
    this.onError = options.onError ?? (() => undefined);
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    if (!this.client) this.client = this.createClient();
    this.connecting = this.waitForInitialConnection(this.client);
    try {
      await this.connecting;
    } catch (error) {
      const client = this.client;
      this.client = null;
      await client?.endAsync(true).catch(() => undefined);
      throw error;
    } finally {
      this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (!client) return;
    await client.endAsync(false);
  }

  async publish(topic: string, payload: string, options: MqttPublishOptions = {}): Promise<void> {
    const client = this.requireConnected();
    assertTopic(topic, false);
    await client.publishAsync(topic, payload, {
      qos: options.qos ?? 0,
      retain: options.retain ?? false,
    });
  }

  async subscribe(subscription: MqttSubscription): Promise<void> {
    const client = this.requireConnected();
    assertTopic(subscription.topic, true);
    await client.subscribeAsync(subscription.topic, { qos: subscription.qos ?? 0 });
  }

  onMessage(handler: MqttMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionState(handler: MqttConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  private createClient(): MqttClient {
    const mqttOptions: IClientOptions = {
      protocolVersion: 4,
      clientId: this.options.clientId,
      clean: this.options.cleanSession ?? true,
      reconnectPeriod: this.options.reconnectPeriodMs ?? 1_000,
      connectTimeout: this.options.connectTimeoutMs ?? 10_000,
      keepalive: this.options.keepaliveSeconds ?? 30,
      resubscribe: true,
      ...(this.options.username ? { username: this.options.username } : {}),
      ...(this.options.password ? { password: this.options.password } : {}),
      ...(this.options.will ? {
        will: {
          topic: this.options.will.topic,
          payload: Buffer.from(this.options.will.payload),
          qos: this.options.will.qos,
          retain: this.options.will.retain,
        },
      } : {}),
    };
    const client = connectMqtt(this.options.brokerUrl, mqttOptions);
    client.on("connect", () => this.emitConnectionState("CONNECTED"));
    client.on("reconnect", () => this.emitConnectionState("RECONNECTING"));
    client.on("offline", () => this.emitConnectionState("OFFLINE"));
    client.on("close", () => this.emitConnectionState("DISCONNECTED"));
    client.on("error", (error) => this.onError(asError(error)));
    client.on("message", (topic, payload, packet) => {
      const message: MqttMessage = {
        topic,
        payload: payload.toString("utf8"),
        qos: packet.qos === 1 ? 1 : 0,
        retained: packet.retain,
      };
      for (const handler of this.messageHandlers) {
        Promise.resolve(handler(message)).catch((error) => this.onError(asError(error)));
      }
    });
    return client;
  }

  private waitForInitialConnection(client: MqttClient): Promise<void> {
    if (client.connected) return Promise.resolve();
    const timeoutMs = this.options.connectTimeoutMs ?? 10_000;
    return new Promise((resolve, reject) => {
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`MQTT connection to ${redactBrokerUrl(this.options.brokerUrl)} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        client.off("connect", onConnect);
      };
      client.once("connect", onConnect);
    });
  }

  private requireConnected(): MqttClient {
    if (!this.client?.connected) throw new Error("MQTT transport is not connected.");
    return this.client;
  }

  private emitConnectionState(state: MqttConnectionState): void {
    for (const handler of this.connectionHandlers) handler(state);
  }
}

function assertBrokerUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MQTT brokerUrl must be a valid URL.");
  }
  if (!["mqtt:", "mqtts:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("MQTT brokerUrl must use mqtt, mqtts, ws, or wss.");
  }
}

function assertTopic(value: string, allowWildcards: boolean): void {
  if (!value || value.includes("\u0000")) throw new Error("MQTT topic must not be empty or contain NUL.");
  if (!allowWildcards && (value.includes("+") || value.includes("#"))) {
    throw new Error("MQTT publish topic must not contain wildcards.");
  }
}

function redactBrokerUrl(value: string): string {
  const url = new URL(value);
  if (url.username) url.username = "redacted";
  if (url.password) url.password = "redacted";
  return url.toString();
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
