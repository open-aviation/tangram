import { shallowRef } from "vue";

export interface AtsuMetadata {
  code: string;
  name: string;
  prefix: string;
  network: string;
}

export const atsuMetadata = shallowRef<Record<string, AtsuMetadata>>({});

let loadPromise: Promise<void> | null = null;

export const normalizeAtsuCode = (code: string | null | undefined) =>
  (code ?? "").trim().toUpperCase();

export const loadAtsuMetadata = () => {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(new URL(/* @vite-ignore */ "./atsu.json", import.meta.url))
    .then(response => {
      if (!response.ok)
        throw new Error(`atsu metadata fetch failed: ${response.status}`);
      return response.json();
    })
    .then((data: unknown) => {
      atsuMetadata.value =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, AtsuMetadata>)
          : {};
    })
    .catch(() => {
      atsuMetadata.value = {};
      loadPromise = null;
    });
  return loadPromise;
};
