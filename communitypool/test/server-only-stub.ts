// Vitest stub for the `server-only` package. The real module throws when
// included in a client bundle to enforce the server boundary at Next.js
// build time. Tests run server modules directly under Node, so we map
// `server-only` to an empty module here.
export {};
