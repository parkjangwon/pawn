import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ko from './locales/ko.json'
import ja from './locales/ja.json'
import zh from './locales/zh.json'

const savedLang = localStorage.getItem('pawn-lang')

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ko: { translation: ko },
    ja: { translation: ja },
    zh: { translation: zh }
  },
  lng: savedLang || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('pawn-lang', lng)
})

export default i18n
