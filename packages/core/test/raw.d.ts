// Vite and Vitest load a file as text with the `?raw` suffix.
declare module '*?raw' { const text: string; export default text; }
