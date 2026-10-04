import type { AnalysisResult, BotResponse, BotStatus, CaptureStatus, GameStateSnapshot } from '@/types'

export type ActionKind = 'discard' | 'chi' | 'pon' | 'daiminkan' | 'ankan' | 'kakan' | 'reach' | 'tsumo' | 'ron' | 'ryukyoku' | 'kita' | 'pass'
export type LegalAction = { kind: ActionKind; tile: string | null; consumed: string[] }
export type ImmersiveFrame = {
  revision: number
  game: GameStateSnapshot | null
  can_act: boolean
  legal_actions: LegalAction[]
  riichi_discards?: string[]
  transport_connected?: boolean
  response: BotResponse | null
  analysis: AnalysisResult | null
  capture: CaptureStatus
  bot_status: BotStatus
}
export type Rect = { x: number; y: number; w: number; h: number }
export type TileRect = Rect & { tile: string; drawn: boolean; index: number }
export type ButtonRect = Rect & { kind: ActionKind }
export type Hint = Rect & {
  id: string; kind: ActionKind; tile?: string; label: string; probability: number | null
  color: string; best: boolean; detail?: string; probabilityNote?: string; risk?: number; choice?: LegalAction
}
export type HostState = { foreground: boolean; panel: boolean; hints: boolean; autoplay?: boolean }
export type GameClick = { x: number; y: number; button: 'left' | 'right' }
