import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Aquí había un `define` que sustituía process.env.API_KEY y
// process.env.GEMINI_API_KEY por el valor real de la clave de Gemini. Servía
// solo a services/geminiService.ts, que estaba huérfano y ya se ha eliminado.
//
// No se restaura: `define` hornea el valor como texto plano en el bundle que se
// sirve al navegador, así que cualquiera podría leer la clave desde el código
// fuente de la página. Las llamadas a Gemini se hacen desde la edge function
// generate-monthly-report, donde la clave vive como secret y no sale del servidor.
export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
