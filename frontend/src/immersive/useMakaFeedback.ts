import { useEffect } from 'react'

/** Only controls whose native CButton enables click_bigger receive scale
 * feedback. Character-menu tabs, dropdowns and switches use color tint only. */
export function useMakaFeedback() {
  useEffect(() => {
    const running = new Map<HTMLElement, Animation>()
    let held: {button:HTMLElement;art:HTMLElement;scale:string} | null = null
    let released: HTMLElement | null = null
    let releaseTimer = 0
    const control = (event:Event) => {
      if (!(event.target instanceof Element)) return null
      const button = event.target.closest<HTMLElement>('.maka-state-button,.maka-feature-button,.maka-risk-tools button,[data-native-press-scale]')
      if (!button || button.matches(':disabled,[aria-disabled=true]')) return null
      const art = button.querySelector<HTMLElement>('.maka-control-art') ?? (button.matches('[data-hud-interactive]') ? button.querySelector<HTMLElement>('img') : null) ?? button
      return {button,art}
    }
    const animate = (art:HTMLElement,frames:Keyframe[],duration:number) => {
      if (typeof art.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      running.get(art)?.cancel()
      const animation = art.animate(frames,{duration,easing:'ease-out'})
      running.set(art,animation)
      animation.onfinish = () => { if(running.get(art)===animation) running.delete(art) }
    }
    const cancel = () => {
      if(held) {
        held.art.style.scale=held.scale
        held=null
      }
      released=null
      window.clearTimeout(releaseTimer)
    }
    const down = (event:PointerEvent) => {
      if(event.button!==0) return
      cancel()
      const target=control(event)
      if(!target) return
      running.get(target.art)?.cancel()
      running.delete(target.art)
      held={...target,scale:target.art.style.scale}
      // CButton holds click_bigger=1.1 until release. Scale the art, never
      // the Windows input region or the button's layout box.
      target.art.style.scale='1.1'
    }
    const up = (event:PointerEvent) => {
      if(event.button!==0 || !held) return
      const {button,art,scale}=held
      held=null
      art.style.scale=scale
      animate(art,[{scale:'1.1'},{scale:scale || '1'}],100)
      released=button
      releaseTimer=window.setTimeout(()=>{released=null},100)
    }
    const click = (event:Event) => {
      const target=control(event)
      if(!target) return
      if(event.type==='click' && released===target.button) { released=null; return }
      animate(target.art,[{scale:'1'},{scale:'1.1',offset:.45},{scale:'1'}],200)
    }
    document.addEventListener('pointerdown',down,true)
    document.addEventListener('pointerup',up,true)
    document.addEventListener('pointercancel',cancel,true)
    window.addEventListener('blur',cancel)
    document.addEventListener('click',click,true)
    document.addEventListener('contextmenu',click,true)
    return () => {
      cancel()
      document.removeEventListener('pointerdown',down,true)
      document.removeEventListener('pointerup',up,true)
      document.removeEventListener('pointercancel',cancel,true)
      window.removeEventListener('blur',cancel)
      document.removeEventListener('click',click,true)
      document.removeEventListener('contextmenu',click,true)
      running.forEach(animation=>animation.cancel())
    }
  },[])
}
