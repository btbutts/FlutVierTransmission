// src/routes/+layout.ts
// SPA mode: disable server-side rendering for the entire app and mark all
// pages as pre-renderable so adapter-static produces a pure static build.
// The 200.html fallback (configured in svelte.config.js) handles deep-link
// refreshes when served from Transmission's web directory or the companion server.

export const prerender = true;
export const ssr = false;
