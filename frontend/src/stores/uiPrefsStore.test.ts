import { beforeEach, describe, expect, it, vi } from 'vitest'

// Node 22+ ships an experimental `localStorage` global that is undefined
// without `--localstorage-file` and shadows jsdom's, so install an explicit
// in-memory stand-in the store and the assertions both see.
function stubLocalStorage() {
  const backing = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
  })
  return backing
}

// The store reads localStorage at module-init, so each test re-imports a
// fresh copy after seeding storage to exercise the load path.
async function freshStore() {
  vi.resetModules()
  const mod = await import('./uiPrefsStore')
  return mod
}

describe('uiPrefsStore AkagiMS promo card state', () => {
  beforeEach(() => {
    stubLocalStorage()
  })

  it('defaults to not dismissed on first launch', async () => {
    const { useUiPrefsStore } = await freshStore()
    expect(useUiPrefsStore.getState().akagimsCardDismissed).toBe(false)
  })

  it('persists dismissal across restarts', async () => {
    const { useUiPrefsStore } = await freshStore()
    useUiPrefsStore.getState().markAkagimsCardDismissed()
    expect(localStorage.getItem('akagi.announcement.akagims.card')).toBe('1')

    const restarted = await freshStore()
    expect(restarted.useUiPrefsStore.getState().akagimsCardDismissed).toBe(true)
  })

  it('keeps the card flag independent of dashboard onboarding', async () => {
    const { useUiPrefsStore } = await freshStore()
    useUiPrefsStore.getState().markDashboardOnboarded()
    expect(useUiPrefsStore.getState().akagimsCardDismissed).toBe(false)

    const restarted = await freshStore()
    expect(restarted.useUiPrefsStore.getState().dashboardOnboarded).toBe(true)
    expect(restarted.useUiPrefsStore.getState().akagimsCardDismissed).toBe(false)
  })

  it('persists model favorites and their removal across restarts', async () => {
    const { useUiPrefsStore } = await freshStore()
    useUiPrefsStore.getState().toggleFavoriteModel('mortal-s42')
    useUiPrefsStore.getState().toggleFavoriteModel('akagi-native3p')
    const restarted = await freshStore()
    expect(restarted.useUiPrefsStore.getState().favoriteModels).toEqual(['mortal-s42', 'akagi-native3p'])
    restarted.useUiPrefsStore.getState().toggleFavoriteModel('mortal-s42')
    const reopened = await freshStore()
    expect(reopened.useUiPrefsStore.getState().favoriteModels).toEqual(['akagi-native3p'])
  })

  it('recovers from malformed favorite storage without losing valid model names', async () => {
    localStorage.setItem('akagi.ui.modelFavorites', 'invalid JSON')
    expect((await freshStore()).useUiPrefsStore.getState().favoriteModels).toEqual([])
    localStorage.setItem('akagi.ui.modelFavorites', JSON.stringify(['mortal-s42', null, 2, 'mortal-s42', '']))
    expect((await freshStore()).useUiPrefsStore.getState().favoriteModels).toEqual(['mortal-s42'])
  })
})
