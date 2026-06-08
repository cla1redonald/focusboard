import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'vendor-react';
          if (id.includes('/@dnd-kit/')) return 'vendor-dnd';
          if (id.includes('/@supabase/') || id.includes('/@vercel/')) return 'vendor-platform';
          if (id.includes('/framer-motion/') || id.includes('/lucide-react/')) return 'vendor-ui';
          return 'vendor';
        },
      },
    },
  },
})
