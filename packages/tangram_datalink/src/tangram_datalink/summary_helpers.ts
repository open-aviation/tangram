import { toRaw } from "vue";
import {
  arinc622Payload,
  avlcAcarsMessage,
  messageApp,
  messageKind,
  messageLabel
} from "./store";
import type { AcarsAppPayload, Arinc622Message, DatalinkMessage } from "./types";

export const rawMessage = (msg: DatalinkMessage) => toRaw(msg);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const arinc622Message = (msg: DatalinkMessage): Arinc622Message | null =>
  arinc622Payload(messageApp(rawMessage(msg)));

const appText = (app: AcarsAppPayload | null | undefined): string | undefined =>
  app && typeof app !== "string" && "text" in app ? app.text : undefined;

export const messageText = (msg: DatalinkMessage): string | undefined => {
  const raw = rawMessage(msg);
  if ("airframes" in raw.message)
    return raw.message.airframes.payload.text ?? appText(raw.message.airframes.app);
  if ("acars" in raw.message)
    return raw.message.acars.text || appText(raw.message.acars.app);
  if ("avlc" in raw.message) {
    const acars = avlcAcarsMessage(raw);
    return acars?.text || appText(acars?.app);
  }
  if ("app" in raw.message) return appText(raw.message.app);
  return undefined;
};

export const messageKeyParts = (msg: DatalinkMessage) => {
  const raw = rawMessage(msg);
  return `${raw.timestamp ?? 0}:${raw.raw_frame_hex ?? ""}:${messageKind(raw.message)}:${messageLabel(raw) ?? ""}`;
};
