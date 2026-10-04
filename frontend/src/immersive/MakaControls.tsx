import { useEffect, useState, type CSSProperties } from 'react'
import type { OverlayConfig } from '@/types'
import { listen } from '@/lib/tauri'
import { NativeSprite } from './NativeSprite'
import './nativeControlMotion.css'

const QUICK_GUIDANCE_OPTIONS = [
  ['show_discards','出牌提示'],['show_analysis','向听与进张'],['show_actions','碰杠吃胡'],
] as const
export const GUIDANCE_OPTIONS = [...QUICK_GUIDANCE_OPTIONS, ['show_risk','听牌提示']] as const
const FEATURE_ROTATIONS = { show_discards: -90, show_analysis: 180, show_actions: 0 }
type GuidanceFeature = typeof GUIDANCE_OPTIONS[number][0]
// The ON sprite adds 15 px of glow on each side of the same 77 px diamond.
// Preserve source-pixel scale when switching; equal img boxes enlarge OFF.
function iconStyle(kind: 'toggle' | 'maka', enabled: boolean, scale: number, box: number, display: number, top = 0): CSSProperties {
  const native = kind === 'toggle' ? (enabled ? 111 : 81) : (enabled ? 110 : 102)
  const size = native * display / (kind === 'toggle' ? 111 : 110)
  return {left:(box-size)/2*scale,top:(top+(box-size)/2)*scale,width:size*scale,height:size*scale}
}

export function MakaControls({cfg,ready,guiding,autoplay,scale,onToggle,onAutoplay,onChange}: {cfg:OverlayConfig;ready:boolean;guiding:boolean;autoplay:boolean;scale:number;onToggle:()=>Promise<void>;onAutoplay:(enabled:boolean)=>Promise<void>;onChange:(feature:GuidanceFeature,enabled:boolean)=>Promise<void>}) {
  const [open,setOpen] = useState(false)
  const [visible,setVisible] = useState(false)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  useEffect(() => { setOpen(false) },[guiding])
  useEffect(() => {
    if(open) { setVisible(true); return }
    // The native maka_btns_hide clip lasts five frames at 60 Hz. Remove its
    // input regions immediately, but let the art finish moving out first.
    const timer=window.setTimeout(()=>setVisible(false),1000/12)
    return ()=>window.clearTimeout(timer)
  },[open])
  useEffect(() => {
    if (!open) return
    let disposed = false
    const unlisteners: Array<()=>void> = []
    const close = () => setOpen(false)
    const key = (e:KeyboardEvent) => { if(e.key === 'Escape') close() }
    window.addEventListener('keydown',key)
    for(const event of ['immersive-cancel','immersive-click']) void listen(event,close).then(u => disposed ? u() : unlisteners.push(u))
    return () => { disposed=true; unlisteners.forEach(u=>u()); window.removeEventListener('keydown',key) }
  },[open])
  const set = async (key: typeof GUIDANCE_OPTIONS[number][0], checked:boolean) => {
    setSaving(true); setError('')
    try { await onChange(key,checked) }
    catch { setError('保存失败，请重试'); setOpen(true) }
    finally { setSaving(false) }
  }
  const toggle = async () => {
    setSaving(true); setError(''); setOpen(false)
    try { await onToggle() }
    catch { setError('切换失败，请重试'); setOpen(true) }
    finally { setSaving(false) }
  }
  const enabled = guiding && ready
  const riskEnabled = cfg.show_risk !== false
  const text = enabled ? '启用中' : '未开启'
  const toggleAutoplay = async () => {
    setSaving(true);setError('')
    try {await onAutoplay(!autoplay)}
    catch {setError('托管切换失败，请重试');setOpen(true)}
    finally {setSaving(false)}
  }
  return <>
    <div className={`maka-state ${autoplay ? 'is-enabled' : ''}`}
      style={{left:6.9*scale,bottom:18.3*scale,width:115*scale,height:115*scale,fontSize:20*scale}}>
      <button data-hud-interactive className="maka-state-button" aria-label="托管挂机" aria-pressed={autoplay}
        title={autoplay ? '关闭托管，恢复手动打牌' : '开启托管，按模型建议自动打牌'} disabled={!autoplay && (saving || !ready)} onClick={()=>void toggleAutoplay()}>
        <span className="maka-control-art">
        <img key={String(autoplay)} src={`/maka/tiles/ob_ting_${autoplay ? 'on' : 'off'}_btn.png`} alt="" style={iconStyle('toggle',autoplay,scale,115,115)} />
        <span className="maka-state-label" style={{top:`${93.5/115*100}%`,padding:`0 ${12*scale}px`,height:24*scale}}>
          <NativeSprite src="/maka/tiles/button_text_bottom_s.png" border={[15,0,15,0]} pixelScale={scale}/><span>托管挂机</span>
        </span>
        </span>
      </button>
    </div>
    <div className={`maka-state ${riskEnabled ? 'is-enabled' : ''}`}
      style={{right:7.5*scale,bottom:237*scale,width:110*scale,height:110*scale,fontSize:20*scale}}>
      <button data-hud-interactive className="maka-state-button" aria-label="听牌提示" aria-pressed={riskEnabled}
        title={`听牌提示：${riskEnabled ? '开启' : '关闭'}对手听牌与放铳信息`} disabled={saving} onClick={()=>void set('show_risk',!riskEnabled)}>
        <span className="maka-control-art">
          <img key={String(riskEnabled)} src={`/maka/tiles/ob_ting_${riskEnabled ? 'on' : 'off'}_btn.png`} alt="" style={iconStyle('toggle',riskEnabled,scale,110,110)} />
          <span className="maka-state-label" style={{padding:`0 ${12*scale}px`,height:24*scale}}>
            <NativeSprite src="/maka/tiles/button_text_bottom_s.png" border={[15,0,15,0]} pixelScale={scale} /><span>听牌提示</span>
          </span>
        </span>
      </button>
    </div>
    <div role="status" aria-label={`MAKA INGAME：${text}`} className={`maka-state ${enabled ? 'is-enabled' : ''}`}
      style={{right:7.5*scale,bottom:129*scale,width:110*scale,height:110*scale,fontSize:20*scale}}>
      <button data-hud-interactive className="maka-state-button" aria-label="MAKA 实时指导" aria-pressed={guiding} aria-expanded={open}
        title="左键：开启／关闭指导；右键：功能设置" disabled={saving} onClick={()=>void toggle()}
        onContextMenu={e=>{e.preventDefault();setOpen(v=>!v)}}>
        <span className="maka-control-art">
        <img key={String(enabled)} src={`/maka/common/maka_match_analysis_button_${enabled ? 'open' : 'close'}.png`} alt="" style={iconStyle('maka',enabled,scale,110,110)} />
        <span className="maka-state-label" style={{padding:`0 ${12*scale}px`,height:24*scale}}>
          <NativeSprite src="/maka/tiles/button_text_bottom_s.png" border={[15,0,15,0]} pixelScale={scale} /><span>{text}</span>
        </span>
        </span>
      </button>
    </div>
    {/* UI_MakaMJ: MakaState center=(right 62.5,bottom 184), native previous/
        next centers=(right 180.5,bottom 237/129), 108px apart. Keep those two
        rows in place and add the third above. Rotate only the arrow sprite. */}
    {(open || visible) && <div className={`maka-quick-settings${open ? '' : ' is-closing'}`} role="group" aria-label="实时指导功能" aria-hidden={!open}
      style={{right:120*scale,bottom:68.5*scale,width:121*scale,height:337*scale,fontSize:20*scale}}>
      {QUICK_GUIDANCE_OPTIONS.map(([key,label],index) => {
        const enabled = cfg[key]!==false
        const imageSrc = `/maka/common/next_difference_${enabled ? 'bright' : 'dark'}.png`
        const nativeSize = enabled ? 121 : 119
        return <button key={key} type="button" data-hud-interactive={open ? true : undefined} className="maka-feature-button"
          aria-label={label} aria-pressed={enabled} title={`${label}：${enabled ? '开启' : '关闭'}`} disabled={saving || !open}
          onClick={()=>void set(key,!enabled)}
          // Keep the overlapping sprite glow outside the click box. Each
          // 101px hit region includes its label and stays within the 108px row.
          style={{left:0,top:(index*108+10)*scale,width:121*scale,height:101*scale,
            '--maka-control-unit':`${scale}px`,'--feature-y-factor':index===0 ? (162+16.9)/(54+16.9) : 1} as CSSProperties}>
          <span className="maka-control-art">
          <img key={imageSrc} src={imageSrc} alt=""
            style={{left:(121-nativeSize)/2*scale,top:(-10+(121-nativeSize)/2)*scale,width:nativeSize*scale,height:nativeSize*scale,transform:`rotate(${FEATURE_ROTATIONS[key]}deg)`}} />
          <span className="maka-feature-label" style={{top:87.5*scale,width:100*scale,height:26*scale}}>
            <NativeSprite src="/maka/common/text_bottom.png" border={[15,0,15,0]} pixelScale={scale} />
            <span>{key === 'show_analysis' ? '向听进张' : label}</span>
          </span>
          </span>
        </button>
      })}
      {error && <span className="maka-quick-error" role="alert" style={{height:26*scale}}>
        <NativeSprite src="/maka/common/text_bottom.png" border={[15,0,15,0]} pixelScale={scale} /><span>{error}</span>
      </span>}
    </div>}
  </>
}
