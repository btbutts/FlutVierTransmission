import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // HTTP RPC Basic Auth (if enabled in Transmission)
  const rpcAuthCreds = {
    username: env.VITE_TRANSMISSION_USERNAME || '',
    password: env.VITE_TRANSMISSION_PASSWORD || ''
  };

  const authString =
    rpcAuthCreds.username && rpcAuthCreds.password
      ? `${rpcAuthCreds.username}:${rpcAuthCreds.password}`
      : undefined;

  return {
    plugins: [
      tailwindcss(),
      Icons({
        compiler: 'svelte',
        autoInstall: true
      }),
      sveltekit()
    ],
    css: {
      devSourcemap: true
    },
    build: {
      // The MDI icon SVG components (vendor-icons chunk) are ~950 kB minified but
      // only ~300 kB gzipped — well within reason. Raise the threshold so Rollup
      // doesn't warn about a chunk that can't be meaningfully split further.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules') || id.includes('\0plugin-')) {
              // MDI icons (unplugin-icons generates virtual modules)
              if (
                id.includes('~icons/') ||
                id.includes('virtual:~icons/') ||
                id.includes('unplugin-icons') ||
                id.includes('@iconify')
              ) {
                return 'vendor-icons';
              }
              // Svelte / SvelteKit runtime — keep together to avoid SSR split issues
              if (id.includes('svelte')) {
                return 'vendor-svelte';
              }
              // Everything else from node_modules
              return 'vendor';
            }
          }
        }
      }
    },
    server: {
      // Exclude PollService/ from Vite's file watcher. PollService has its own
      // tsconfig and build pipeline (tsc, not Vite) — changes there are irrelevant
      // to the SvelteKit dev server and should not trigger cache flushes or reloads.
      watch: {
        ignored: ['**/PollService/**']
      },
      proxy: {
        // Forward /api/* to the locally running PollService dev process.
        // When PollService is running ('npm run dev:pollservice'), requests like
        // fetch('/api/appstate') are proxied to http://localhost:19091/api/appstate
        // and serverAvailable becomes true in the browser — mirroring Mode B production.
        // When PollService is NOT running, requests fail silently and serverAvailable
        // stays false — mirroring Mode A production. No special dev-mode branching needed.
        '/api': {
          target: 'http://localhost:19091',
          changeOrigin: false
        },
        '/transmission': {
          target: 'http://10.1.10.172:9092', // Change if your Transmission is on a different host/port
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
              proxyRes.headers['Access-Control-Allow-Headers'] =
                'Content-Type, X-Transmission-Session-Id';
            });
          }
        }
      }
    }
  };
});
