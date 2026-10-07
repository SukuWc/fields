import { defineConfig } from 'vite'

// GitHub Pages serves this project at /<repo>/ (https://<owner>.github.io/fields/).
// `npm run build` keeps that production base. PR previews set VITE_BASE_PATH to the
// folder they are deployed into, for example /fields/pr-preview/pr-12/.
// The dev server stays at / so `npm start` is unchanged.
function pagesBase() {
  let raw = (process.env.VITE_BASE_PATH || '/fields/').trim()
  if (!raw.startsWith('/')) raw = `/${raw}`
  if (raw !== '/' && !raw.endsWith('/')) raw = `${raw}/`
  return raw
}

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : pagesBase(),
}))
