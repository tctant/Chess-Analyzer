import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// vite proxies /api/* to fastapi during dev so we can fetch('/api/...')
// without dealing with CORS or hardcoding the backend URL anywhere
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true
            }
        }
    }
});
