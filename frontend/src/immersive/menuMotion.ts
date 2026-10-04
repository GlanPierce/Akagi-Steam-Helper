import type { CSSProperties } from 'react'
import nativeMotion from './nativeMenuMotion.json'
import './nativeMenuMotion.css'

export function menuMotionDuration(phase: 'in' | 'out') {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : nativeMotion.clips[phase].durationMs
}

export const menuMotionStyle = {
  '--menu-enter-time': `${nativeMotion.clips.in.durationMs}ms`,
  '--menu-exit-time': `${nativeMotion.clips.out.durationMs}ms`,
} as CSSProperties
