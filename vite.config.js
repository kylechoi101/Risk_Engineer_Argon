import { defineConfig } from 'vite';

// In dev, /api goes to the FastAPI backend on :8000 (cd backend && uv run fastapi dev).
export default defineConfig({
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8000' } }
});
