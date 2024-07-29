import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/dist/vite'

export default defineConfig({
  server: {
    proxy: {
      // string shorthand: http://localhost:5173/foo -> http://localhost:4567/foo
      // with options: http://localhost:5173/api/bar-> http://jsonplaceholder.typicode.com/bar
      '/data': 'http://localhost:18000',
      '^/plugins.*': {
        target: 'https://localhost:18000/plugins.*',
        changeOrigin: true,
      },
      '^/flight/.*': {
        target: 'https://localhost:18000/flight/.*',
        changeOrigin: true,
      },
      // Proxying websockets or socket.io: ws://localhost:5173/socket.io -> ws://localhost:5174/socket.io
      // Exercise caution using `rewriteWsOrigin` as it can leave the proxying open to CSRF attacks.
      '/websocket': {
        target: 'ws://localhost:18000/websocket?userToken=joining-token&vsn=2.0.0',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  plugins:[
    vue(), // 默认配置vue插件
    AutoImport({ imports: ["vue", "vue-router"] }), // 配置vue、vue-router的API自动加载
  ]
})
