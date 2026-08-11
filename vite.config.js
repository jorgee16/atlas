import { defineConfig } from 'vite';
export default defineConfig({server:{proxy:{'/transit-api':{target:'http://127.0.0.1:8787',changeOrigin:true,rewrite:path=>path.replace(/^\/transit-api/,'')}}}});
