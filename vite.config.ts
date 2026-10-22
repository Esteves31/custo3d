import { existsSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

const OUT_DIR = 'dist';
const FINAL_NAME = 'custo3d.html';

/** O Vite sempre gera index.html; a entrega precisa se chamar custo3d.html. */
function renameOutput(): Plugin {
  return {
    name: 'custo3d-rename-output',
    apply: 'build',
    closeBundle() {
      const from = resolve(OUT_DIR, 'index.html');
      const to = resolve(OUT_DIR, FINAL_NAME);
      if (!existsSync(from)) return;
      if (existsSync(to)) rmSync(to);
      renameSync(from, to);
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    // Mostrado no rodapé para saber qual versão o colega está usando.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [viteSingleFile(), renameOutput()],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    target: 'es2020',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
