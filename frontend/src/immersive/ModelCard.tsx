import { isNativeBot } from '@/lib/nativeBots'
import type { BotInfo } from '@/types'
import { cardName, modelLabel, modeName, portrait, type ModelMode } from './modelPresets'
import { useModelImportStore } from './modelImportStore'

export function ModelCard({ bot, mode, selected, assigned, favorite, disabled, onSelect, onFavorite }: {
  bot: BotInfo; mode: ModelMode; selected: boolean; assigned: boolean; favorite: boolean
  disabled: boolean; onSelect: () => void; onFavorite: () => void
}) {
  const ready = isNativeBot(bot.name) || (bot.has_pyproject && bot.env_ready)
  const label = modelLabel(bot)
  return <div className="hud-model-choice" data-active={assigned} data-selected={selected}>
    <label className="hud-model-card" title={label}>
      <input type="radio" name={`model-${mode}`} checked={selected} aria-checked={selected} readOnly disabled={disabled || !ready} aria-label={`为${modeName(mode)}指定 ${label}`} onClick={onSelect} />
      <img className="hud-model-glow" src="/maka/dorm/sushe_click_effect.png" alt="" />
      <span className="hud-model-portrait" aria-hidden="true"><img src={portrait(bot.name)} alt="" /></span>
      <img className="hud-model-outline" src="/maka/dorm/sushe_card_normal_outline.png" alt="" />
      {assigned && <img className="hud-model-using" src="/maka/lobby_chs/using_1.png" alt="" />}
      <span className="hud-model-name" data-long={cardName(bot).length > 6}>{cardName(bot)}</span>
    </label>
    {(selected || favorite) && <button className="hud-model-favorite" type="button" disabled={disabled} aria-label={`${favorite ? '取消收藏' : '收藏'} ${label}`} title={favorite ? '取消收藏' : '收藏'} aria-pressed={favorite} onClick={onFavorite}>
      <img src={`/maka/dorm/sushe_card_normal_star_${favorite ? 'light' : 'dark'}.png`} alt="" />
    </button>}
    {!ready && bot.has_pyproject && <button className="hud-local-button hud-model-install" data-native-press-scale disabled={disabled} aria-label={`为 ${label} 安装环境`} onClick={() => void useModelImportStore.getState().prepareEnvironment(bot.name)}>安装</button>}
  </div>
}
