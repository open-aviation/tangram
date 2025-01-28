import { createApp } from "vue";
import App from "./App.vue";
import { createPinia } from "pinia";

const app = createApp(App);
const pinia = createPinia();

const components = {
  install: (app) => {
    const modules = import.meta.glob("../../plugins/*/web/components/*", {
      eager: true,
    });
    // const modules = import.meta.glob('../components/plugins/*', { eager: true });
    console.info(modules);

    Object.entries(modules).forEach(([path, m]) => {
      const name = path
        .split("/")
        .pop()
        .replace(/\.\w+$/, "");
      console.info(name);
      app.component("Plugin" + name, m["default"]);
    });
  },
};

app.use(pinia).use(components).mount("#app");
