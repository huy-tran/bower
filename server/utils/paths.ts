import { resolve } from 'node:path'

// Storage roots. Kept free of imports so any module can use them without circular-import trouble.
export const STORAGE = resolve(process.env.BOWER_STORAGE || 'storage/projects')
export const PROJECT_TRASH = resolve(STORAGE, '..', 'trash')
export const BRAND_KITS = resolve(STORAGE, '..', 'brand-kits')
export const TEMPLATES = resolve(STORAGE, '..', 'templates')
