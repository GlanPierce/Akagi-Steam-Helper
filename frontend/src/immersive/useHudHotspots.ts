import { useLayoutEffect, type RefObject } from 'react'
import { invoke, listen } from '@/lib/tauri'

let generation = Date.now()*1000
type NativeHit = {generation:number;x:number;y:number;button?:'left'|'right'}
/** Publish only controls that really exist in the rendered HUD. The Windows
 * host otherwise leaves the entire overlay transparent to mouse input. */
export function useHudHotspots(root: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled || !root.current) {
      void invoke('set_immersive_hotspots',{generation:++generation,aspect:1,regions:[]}).catch(()=>{})
      return
    }
    const element = root.current
    let queued = 0, previous = '', published = 0, disposed = false
    const unlisteners: Array<()=>void> = []
    let held: {target:HTMLElement;generation:number;button:number} | null = null
    const pointer = (type:string,target:HTMLElement,button:number) =>
      target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button}))
    const cancel = () => {
      if(held) pointer('pointercancel',held.target,held.button)
      held=null
    }
    const hitTarget = (hit:NativeHit) => {
      const bounds=element.getBoundingClientRect()
      const target=document.elementFromPoint(bounds.left+hit.x*bounds.width,bounds.top+hit.y*bounds.height)?.closest<HTMLElement>('button,input,label')
      return target && element.contains(target) && target.closest('[data-hud-interactive]') && !target.matches(':disabled,[aria-disabled=true]') ? target : null
    }
    const registered = (u:()=>void) => disposed ? u() : unlisteners.push(u)
    void listen<NativeHit & {phase:'down'|'cancel'}>('immersive-hud-pointer',event=>{
      if(disposed) return
      if(event.phase==='cancel') {
        if(held?.generation===event.generation) cancel()
        return
      }
      if(event.generation!==published) return
      cancel()
      const target=hitTarget(event)
      if(target) {
        held={target,generation:event.generation,button:event.button==='right' ? 2 : 0}
        pointer('pointerdown',target,held.button)
      }
    }).then(registered).catch(()=>{})
    void listen<NativeHit>('immersive-hud-click',click=>{
      if (disposed || click.generation!==published) return
      const target=hitTarget(click)
      if(held) {
        if(target!==held.target || held.button!==(click.button==='right' ? 2 : 0)) { cancel(); return }
        pointer('pointerup',held.target,held.button)
        held=null
      }
      if(target) {
        if(click.button==='right') target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))
        else target.click()
      }
    }).then(registered).catch(()=>{})
    const publish = () => {
      queued = 0
      const bounds = element.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const regions = [...element.querySelectorAll<HTMLElement>('[data-hud-interactive]')].flatMap(node => {
        const r = node.getBoundingClientRect()
        if (!r.width || !r.height || getComputedStyle(node).visibility === 'hidden') return []
        const x = Math.max(0,(r.left-bounds.left)/bounds.width), y = Math.max(0,(r.top-bounds.top)/bounds.height)
        const right = Math.min(1,(r.right-bounds.left)/bounds.width), bottom = Math.min(1,(r.bottom-bounds.top)/bounds.height)
        return right>x && bottom>y ? [{x,y,w:right-x,h:bottom-y}] : []
      })
      const payload = {aspect:bounds.width/bounds.height,regions}
      const signature = JSON.stringify(payload)
      if (signature !== previous) {
        cancel()
        previous = signature
        published = ++generation
        void invoke('set_immersive_hotspots',{generation:published,...payload}).catch(()=>{})
      }
    }
    const schedule = () => { if (!queued) queued = requestAnimationFrame(publish) }
    const mutations = new MutationObserver(schedule)
    mutations.observe(element,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden','data-hud-interactive']})
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    schedule()
    return () => {
      cancel(); disposed=true; unlisteners.forEach(u=>u())
      mutations.disconnect(); resize.disconnect(); cancelAnimationFrame(queued)
      void invoke('set_immersive_hotspots',{generation:++generation,aspect:1,regions:[]}).catch(()=>{})
    }
  },[root,enabled])
}
