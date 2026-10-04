import type { ReactNode } from 'react'

export const MENU_VERSION = 'alpha_test_0.0.1_20261004'

export function MenuFooter({ children }: { children: ReactNode }) {
  return <footer className="hud-menu-footer">
    <div className="hud-menu-footer-actions">{children}</div>
    <span className="hud-menu-version">{MENU_VERSION}</span>
  </footer>
}
