// How the bundle (rolldown.config.mjs) and Vitest both read these imports, as Vite does: `?raw` is
// a file's text, and `?inline` a data URL of its bytes.
declare module '*?raw' {
  const text: string;
  export default text;
}
declare module '*?inline' {
  const url: string;
  export default url;
}
