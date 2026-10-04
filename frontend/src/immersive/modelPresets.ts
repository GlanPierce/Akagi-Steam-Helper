import { NATIVE_3P, NATIVE_4P, isNativeBot } from '@/lib/nativeBots'
import type { AppConfig, BotInfo, ModelPreset } from '@/types'

export type ModelMode = '4p' | '3p'
export const MODEL_MODES = ['4p', '3p'] as const
export const modeTitle = (mode: ModelMode) => mode === '4p' ? '四人东/南' : '三人东/南'
export const modeName = (mode: ModelMode) => mode === '4p' ? '四人局' : '三人局'
export const modeKey = (mode: ModelMode) => mode === '4p' ? 'model_4p' : 'model_3p'
export const builtins: BotInfo[] = [
  { name: NATIVE_4P, dir: '', has_pyproject: false, env_ready: true },
  { name: NATIVE_3P, dir: '', has_pyproject: false, env_ready: true },
]
export const modelPortraits: Record<string, string> = {
  [NATIVE_4P]: '/maka/akagi_portrait/bighead.png',
  [NATIVE_3P]: '/maka/akagi_0_portrait/bighead.png',
  'mortal-298k': '/maka/akagi_sp2_portrait/bighead.png',
  'mortal-s42': '/maka/akagi_sp_portrait/bighead.png',
}
export const portrait = (name: string) => modelPortraits[name] ?? '/maka/common/maka_match_analysis_button_open.png'
export function supports(bot: BotInfo, mode: ModelMode) {
  if (bot.name === NATIVE_4P) return mode === '4p'
  if (bot.name === NATIVE_3P) return mode === '3p'
  return (bot.manifest?.bot.supported_modes ?? ['4p']).includes(mode)
}
export function modelLabel(bot: BotInfo) {
  if (bot.name === NATIVE_4P) return '内置四人模型'
  if (bot.name === NATIVE_3P) return '内置三人模型'
  return bot.manifest?.bot.display || bot.name
}
export function cardName(bot: BotInfo) {
  if (isNativeBot(bot.name)) return '内置'
  const name = modelLabel(bot).replace(/\s*\(Local\)\s*$/i, '')
  return name.match(/(?:^|\s)(S\d+|\d+k)\b/i)?.[1] ?? name
}
export function presetView(bot?: AppConfig['bot']) {
  const active = bot?.active_model_preset ?? 0
  const activeIndex = active >= 0 && active < 10 ? active : 0
  const presets: ModelPreset[] = Array.from({ length: 10 }, (_, i) => ({
    name: String(i + 1), model_4p: NATIVE_4P, model_3p: NATIVE_3P, ...bot?.model_presets?.[i],
  }))
  if (bot) presets[activeIndex] = { ...presets[activeIndex], model_4p: bot.active_4p, model_3p: bot.active_3p }
  return { activeIndex, presets }
}
