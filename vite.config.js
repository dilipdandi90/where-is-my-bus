import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'

// Browsers only allow location access on localhost or HTTPS, so testing on a phone needs HTTPS.
// `npm run dev:phone` serves over HTTPS on the local network with a self-signed certificate.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: {
    host: mode === 'phone',
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:8080',
        // To the browser this is its own origin, so the backend shouldn't treat it as cross-origin.
        configure: (proxy) => proxy.on('proxyReq', (request) => request.removeHeader('origin')),
      },
    },
  },
}))
