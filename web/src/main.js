import { createApp } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import components from './utils/index.js'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia).use(components).mount('#app')

