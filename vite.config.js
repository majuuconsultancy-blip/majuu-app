import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

function resolveLocalApiFile(pathname = "") {
  const safePath = String(pathname || "").replace(/\/+$/, "");
  if (!safePath.startsWith("/api")) return "";

  const directPath = path.join(process.cwd(), `${safePath.replace(/^\/+/, "")}.js`);
  if (existsSync(directPath)) return directPath;

  const indexPath = path.join(process.cwd(), safePath.replace(/^\/+/, ""), "index.js");
  if (existsSync(indexPath)) return indexPath;

  return "";
}

function createNodeLikeResponse(res) {
  let currentStatus = 200;

  return {
    status(code) {
      currentStatus = Number(code || 200) || 200;
      return this;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return this;
    },
    json(payload) {
      if (!res.headersSent) {
        res.statusCode = currentStatus;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(payload));
      return this;
    },
    send(payload) {
      if (!res.headersSent) {
        res.statusCode = currentStatus;
      }
      if (typeof payload === "object" && payload !== null) {
        if (!res.headersSent) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        res.end(JSON.stringify(payload));
        return this;
      }
      res.end(String(payload ?? ""));
      return this;
    },
    end(payload = "") {
      if (!res.headersSent) {
        res.statusCode = currentStatus;
      }
      res.end(payload);
      return this;
    },
  };
}

function localVercelApiPlugin() {
  return {
    name: "local-vercel-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url ? new URL(req.url, "http://127.0.0.1").pathname : "";
        const apiFile = resolveLocalApiFile(pathname);
        if (!apiFile) {
          next();
          return;
        }

        try {
          const moduleUrl = `${pathToFileURL(apiFile).href}?t=${Date.now()}`;
          const mod = await import(moduleUrl);
          const handler = mod?.default;
          if (typeof handler !== "function") {
            next();
            return;
          }

          await handler(req, createNodeLikeResponse(res));
          if (!res.writableEnded) {
            res.end();
          }
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          res.end(
            JSON.stringify({
              ok: false,
              message: "Local API route failed.",
              error: String(error?.message || error),
            })
          );
        }
      });
    },
  };
}

export default defineConfig({
  build: {
  rollupOptions: {
    output: {
      manualChunks: {
        react: ["react", "react-dom", "react-router-dom"],
        firebase: [
          "firebase/app",
          "firebase/auth",
          "firebase/firestore",
        ],
      },
    },
  },
},

  plugins: [
    localVercelApiPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      // ✅ Service worker updates automatically in the background
      registerType: "autoUpdate",

      // ✅ Auto-inject SW registration (prod only)
      injectRegister: "auto",

      // ✅ These files must exist in /public
      includeAssets: [
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/maskable-192.png",
        "icons/maskable-512.png",
        "apple-touch-icon.png",
      ],

      // ✅ Web App Manifest
      manifest: {
        name: "MAJUU",
        short_name: "MAJUU",
        description: "Study, work & travel abroad (Self-Help or We-Help).",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0B1220",
        theme_color: "#0B1220",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      // ✅ Caching strategy (read-only offline)
      // - App shell + last visited pages cached
      // - Static assets cached
      // - Avoid caching Firestore/Auth calls (prevents stale + weirdness)
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          // Pages (SPA navigation): NetworkFirst with short timeout
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" && url.origin === self.location.origin,
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },

          // JS/CSS/Workers
          {
            urlPattern: ({ request }) =>
              ["style", "script", "worker"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-assets",
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },

          // Images
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images",
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },

      // ✅ Keep SW off in dev (avoids caching headaches while coding)
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
