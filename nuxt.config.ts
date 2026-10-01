export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  ssr: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Bower',
      link: [{ rel: 'icon', href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="%23111"/><rect x="6" y="7" width="12" height="10" rx="1.5" fill="none" stroke="white" stroke-width="2"/></svg>' }]
    }
  },
  colorMode: { preference: 'light', fallback: 'light' },
  icon: { serverBundle: 'local' }
})
