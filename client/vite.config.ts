import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The browser only talks to one address, the same as in production.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
