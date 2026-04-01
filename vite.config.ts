import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // HTTP RPC Basic Auth (if enabled in Transmission)
  const rpcAuthCreds = {
    username: env.VITE_TRANSMISSION_USERNAME || '',
    password: env.VITE_TRANSMISSION_PASSWORD || ''
  }

  const authString = rpcAuthCreds.username && rpcAuthCreds.password
    ? `${rpcAuthCreds.username}:${rpcAuthCreds.password}`
    : undefined;

  return {
    plugins: [
      tailwindcss(),
      Icons({
        compiler: 'svelte',
        autoInstall: true,
      }),
      sveltekit()
    ],
    css: {
      devSourcemap: true
    },
    server: {
      proxy: {
        '/transmission': {
          target: 'http://10.1.10.172:9092',   // Change if your Transmission is on a different host/port
          changeOrigin: true,
          secure: false,

          auth: authString,

          // Set CORS headers
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (
                rpcAuthCreds.username &&
                rpcAuthCreds.password &&
                !proxyReq.getHeader('Authorization')
              ) {
                const basicAuth = Buffer.from(
                  `${rpcAuthCreds.username}:${rpcAuthCreds.password}`
                ).toString('base64');
                proxyReq.setHeader('Authorization', `Basic ${basicAuth}`);
              }
            });
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.headers['Access-Control-Allow-Origin'] = '*';
              proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
              proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Transmission-Session-Id';
            });
          }
        }
      }
    }
  }
});
