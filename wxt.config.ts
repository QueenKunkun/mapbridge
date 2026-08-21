import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'MapBridge',
    description: '地图收藏夹迁移：百度 ↔ 高德 ↔ 腾讯，本地浏览器内完成',
  },
});