/**
 * Pure tab bookkeeping for the embedded browser's multi-view support.
 *
 * Electron-free on purpose: the create / switch / close semantics (including
 * which tab becomes active when the active one closes) live here so they are
 * unit-testable without a WebContentsView. The IPC layer (src/main/ipc/browser.ts)
 * owns one WebContentsView per tab id and drives this manager via events.
 *
 * Tab lifecycle rules (browser-like):
 * - create()  → appended, becomes the active tab
 * - switch()  → no-op when the tab is already active
 * - close()   → closing the active tab activates the right neighbor, else the
 *               left neighbor, else none
 */

export interface BrowserTabInfo {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /**
   * Owner key that this tab is bound to, enabling parallel browsing:
   * - `session:<sessionId>`  — a chat session's agent (drives the visible tab)
   * - `subagent:<runId>`     — one subagent run (parked, never yanks the UI)
   * - null                   — UI-created tab / legacy calls
   */
  owner: string | null
}

export class BrowserTabManager {
  private tabs: BrowserTabInfo[] = []
  private _active: string | null = null
  private counter = 0

  get active(): BrowserTabInfo | null {
    return this.activeId ? this.getById(this.activeId) ?? null : null
  }

  get activeId(): string | null {
    return this._active
  }

  /** Shallow copies so callers cannot mutate internal records. */
  get list(): BrowserTabInfo[] {
    return this.tabs.map((t) => ({ ...t }))
  }

  get count(): number {
    return this.tabs.length
  }

  has(id: string | null | undefined): boolean {
    return !!id && this.tabs.some((t) => t.id === id)
  }

  getById(id: string | null | undefined): BrowserTabInfo | undefined {
    if (!id) return undefined
    const tab = this.tabs.find((t) => t.id === id)
    return tab ? { ...tab } : undefined
  }

  /** Append a tab and make it active. Returns a copy of the new tab. */
  create(initial: { url?: string; title?: string; owner?: string | null } = {}): BrowserTabInfo {
    const tab: BrowserTabInfo = {
      id: `tab-${++this.counter}`,
      url: initial.url || '',
      title: initial.title || '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      owner: initial.owner ?? null
    }
    this.tabs.push(tab)
    this._active = tab.id
    return { ...tab }
  }

  /** Find the tab bound to an owner key (reuse instead of spawning a new one). */
  findByOwner(owner: string | null | undefined): BrowserTabInfo | undefined {
    if (!owner) return undefined
    const tab = this.tabs.find((t) => t.owner === owner)
    return tab ? { ...tab } : undefined
  }

  /** Make `id` the active tab. Passing null unsets it (no visible tab). */
  switch(id: string | null): boolean {
    if (id !== null && !this.has(id)) return false
    if (id === this._active) return false
    this._active = id
    return true
  }

  /**
   * Close a tab. When the active tab closes, the right neighbor becomes active
   * (falling back to the left, then none). Returns the closed tab and the id
   * that should be active afterwards, or null when the id is unknown.
   */
  close(id: string): { closed: BrowserTabInfo; nextActiveId: string | null } | null {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return null
    const [closed] = this.tabs.splice(idx, 1)
    if (this._active === id) {
      const neighbor = this.tabs[idx] ?? this.tabs[idx - 1] ?? null
      this._active = neighbor ? neighbor.id : null
    }
    return { closed: { ...closed }, nextActiveId: this.activeId }
  }

  /** Apply a partial update to a tab's mutable fields. */
  patch(id: string, patch: Partial<Omit<BrowserTabInfo, 'id'>>): boolean {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return false
    Object.assign(tab, patch)
    return true
  }

  clear(): void {
    this.tabs = []
    this._active = null
  }
}
