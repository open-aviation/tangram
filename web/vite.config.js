import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/dist/vite'

let tangram_service = process.env.TANGRAM_SERVICE || '127.0.0.1:18000';

export default defineConfig({
  server: {
    proxy: {
      // string shorthand: http://localhost:5173/foo -> http://localhost:4567/foo
      // with options: http://localhost:5173/api/bar-> http://jsonplaceholder.typicode.com/bar
      '/data': `http://${tangram_service}`,
      '^/plugins.*': {
        target: `https://${tangram_service}/plugins.*`,
        changeOrigin: true,
      },
      '^/flight/.*': {
        target: `https://${tangram_service}/flight/.*`,
        changeOrigin: true,
      },
      // Proxying websockets or socket.io: ws://localhost:5173/socket.io -> ws://localhost:5174/socket.io
      // Exercise caution using `rewriteWsOrigin` as it can leave the proxying open to CSRF attacks.
      '/websocket': {
        target: `ws://${tangram_service}/websocket?userToken=joining-token&vsn=2.0.0`,
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  plugins: [
    vue(), // 默认配置vue插件
    AutoImport({ imports: ["vue", "vue-router"] }), // 配置vue、vue-router的API自动加载
  ]
})
