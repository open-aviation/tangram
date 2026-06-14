import { toRaw } from "vue";
import { arinc622Payload, messageApp, messageData, messageLabel } from "./store";
import type { Arinc622Message, DatalinkMessage, JsonObject } from "./types";

export const rawMessage = (msg: DatalinkMessage) => toRaw(msg) as DatalinkMessage;

export const isRecord = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const adjacentData = (value: unknown): unknown =>
  isRecord(value) && typeof value.kind === "string" && "data" in value
    ? value.data
    : value;

export const arinc622Message = (msg: DatalinkMessage): Arinc622Message | null =>
  arinc622Payload(messageApp(rawMessage(msg)));

export const decodedArincPayload = (msg: DatalinkMessage) =>
  arinc622Message(msg)?.payload?.data ?? null;

// these field readers are deliberately small compatibility shims for loose
// Airframes payloads and unknown protocol branches.
// new protocol-specific renderers should prefer typed payload unions from store.ts.
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
  return app?.kind === "none" ? null : (app?.kind ?? null);
};

export const messageText = (msg: DatalinkMessage): string | undefined => {
  const raw = rawMessage(msg);
  const data = messageData(raw);
  const payload = data && isRecord(data.payload) ? data.payload : null;
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
