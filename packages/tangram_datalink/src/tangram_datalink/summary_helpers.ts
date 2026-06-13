import { toRaw } from "vue";
import {
  messageApp,
  messageData,
  messageLabel,
  type AcarsAppPayload,
  type Arinc622Message,
  type DatalinkMessage,
  type JsonObject
} from "./store";

export const rawMessage = (msg: DatalinkMessage) => toRaw(msg) as DatalinkMessage;

export const isRecord = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const externalPayload = <T>(value: unknown, key: string): T | null =>
  isRecord(value) && key in value ? (value[key] as T) : null;

export const adjacentData = (value: unknown): unknown =>
  isRecord(value) && typeof value.kind === "string" && "data" in value
    ? value.data
    : value;

export const arinc622Payload = (
  app: AcarsAppPayload | null | undefined
): Arinc622Message | null => externalPayload<Arinc622Message>(app, "Arinc622");

export const stringField = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

export const numberField = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" ? field : undefined;
};

export const arrayField = (value: unknown, key: string): unknown[] => {
  if (!isRecord(value)) return [];
  const field = value[key];
  return Array.isArray(field) ? field : [];
};

export const appKind = (msg: DatalinkMessage): string | null => {
  const app = messageApp(rawMessage(msg));
  if (typeof app === "string") return app === "None" ? null : app;
  if (!isRecord(app)) return null;
  const keys = Object.keys(app);
  return keys.length === 1 ? keys[0] : null;
};

export const arinc622Message = (msg: DatalinkMessage) =>
  arinc622Payload(messageApp(rawMessage(msg)));

export const decodedArincPayload = (msg: DatalinkMessage) => {
  const payload = arinc622Message(msg)?.payload;
  return payload == null ? null : adjacentData(payload);
};

export const messageText = (msg: DatalinkMessage): string | undefined => {
  const raw = rawMessage(msg);
  const data = messageData(raw);
  const payload = isRecord(data?.payload) ? data.payload : null;
  return (
    stringField(data, "text") ??
    stringField(data, "txt") ??
    stringField(payload, "text") ??
    stringField(payload, "txt")
  );
};

export const messageKeyParts = (msg: DatalinkMessage) => {
  const raw = rawMessage(msg);
  return `${raw.timestamp ?? 0}:${raw.raw_frame_hex ?? ""}:${raw.message.kind}:${messageLabel(raw) ?? ""}`;
};
