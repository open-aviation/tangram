import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import { registerComponents } from "virtual:plugin-components";

const app = createApp(App);
const pinia = createPinia();
registerComponents(app);
app.use(pinia).mount("#app");
