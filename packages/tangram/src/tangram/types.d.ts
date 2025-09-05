import type { App, Component } from "vue";

export interface TangramApi {
  /**
   * Registers a widget component with the core application.
   * This makes the component available to be rendered in the UI.
   * @param id - A unique identifier for the widget component.
   * @param component - The Vue component to register.
   */
  registerWidget(id: string, component: Component): void;

  /**
   * Provides access to the core Vue application instance for advanced use cases.
   */
  getVueApp(): App;
}
