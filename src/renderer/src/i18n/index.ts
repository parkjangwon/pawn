import { EN, tx } from './strings'

/**
 * English-only UI strings. Pawn v3 ships a single locale: dynamic lookups
 * (status- or kind-driven keys) go through {@link tx}; everything else is an
 * inline literal. No language detection, no switching.
 */
const i18n = {
  language: 'en' as const,
  t: tx,
  async changeLanguage(): Promise<void> {},
}

export { EN, tx }
export default i18n
