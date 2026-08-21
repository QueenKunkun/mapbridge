import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'MapBridge',
    description: 'Migrate map favorites between Baidu Maps and Amap — fully local, no server needed',
  },
});