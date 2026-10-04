import type { CSSProperties } from 'react'
import nativeMotion from './nativeMenuMotion.json'
import './nativeMenuMotion.css'

export function menuMotionDuration(phase: 'in' | 'out') {
  return reducedMotion() ? 0 : nativeMotion.menu[phase].durationMs
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function pageMotionTiming(targetPath: string) {
  // Our model presets use page_deco. The calibration page takes the other
  // page's fade sequence, retaining its own full-width controls layout.
  if (reducedMotion()) return { outMs: 0, inMs: 0 }
  return nativeMotion.page[targetPath === '/' ? 'toDecoration' : 'fromDecoration']
}

export const menuMotionStyle = {
  '--menu-enter-time': `${nativeMotion.menu.in.durationMs}ms`,
  '--menu-exit-time': `${nativeMotion.menu.out.durationMs}ms`,
  '--menu-header-offset': `${nativeMotion.menu.headerOffsetY}px`,
  '--menu-panel-offset': `${nativeMotion.menu.panelOffsetX}px`,
  '--menu-frame-time': `${nativeMotion.frame.durationMs}ms`,
  '--menu-ease': nativeMotion.ease,
} as CSSProperties
