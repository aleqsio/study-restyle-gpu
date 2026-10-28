import typegpu from 'unplugin-typegpu/vite';
import { defineConfig } from 'vite';

export default defineConfig({ base: './', plugins: [typegpu()] });
