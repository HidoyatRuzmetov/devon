let configuredUrl = 'http://localhost:5173'
export function configurePublicUrl(url: string) {
  configuredUrl = url
}
export function publicUrl() {
  return configuredUrl
}
export function miniappUrl() {
  return `${publicUrl().replace(/\/+$/, '')}/miniapp/`
}
