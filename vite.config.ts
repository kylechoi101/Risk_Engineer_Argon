import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // /api goes to the FastAPI backend (cd backend && uv run fastapi dev).
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
