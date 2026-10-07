// Vitest and the esbuild build (scripts/build.mjs) load a file as text with the `?raw` suffix.
declare module '*?raw' { const text: string; export default text; }
