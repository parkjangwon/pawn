export {}

declare global {
  interface Window {
    api: {
      platform: string
      selectFolder: () => Promise<string | null>
    }
  }
}
