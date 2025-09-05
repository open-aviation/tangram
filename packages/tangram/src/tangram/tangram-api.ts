import { App, shallowRef, Component } from "vue";
import type { TangramApi } from "./types";

export const registeredWidgets = shallowRef<Record<string, Component>>({});

export function createTangramApi(app: App): TangramApi {
  return {
    getVueApp: () => app,
    registerWidget: (id: string, component: Component) => {
      if (registeredWidgets.value[id]) {
        console.warn(`widget with id "${id}" is already registered.`);
        return;
      }
      app.component(id, component);
      registeredWidgets.value = { ...registeredWidgets.value, [id]: component };
    }
  };
}
