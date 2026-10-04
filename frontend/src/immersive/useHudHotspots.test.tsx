import { useRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
type NativeEvent = {generation:number;x:number;y:number;button?:'left'|'right';phase?:'down'|'cancel'}
const native = vi.hoisted(()=>({invoke:vi.fn().mockResolvedValue(undefined),events:new Map<string,(p:NativeEvent)=>void>()}))
vi.mock('@/lib/tauri',()=>({invoke:native.invoke,listen:async (name:string,fn:(p:NativeEvent)=>void)=>{native.events.set(name,fn); return ()=>{native.events.delete(name)}}}))
import { useHudHotspots } from './useHudHotspots'
import { useMakaFeedback } from './useMakaFeedback'
afterEach(()=>{vi.restoreAllMocks();native.invoke.mockClear()})

it('relays only current native control hits and clears the input region on hide',async()=>{
  const clicked=vi.fn()
  const context=vi.fn()
  function Harness({enabled}:{enabled:boolean}) {
    const ref=useRef<HTMLDivElement>(null)
    useHudHotspots(ref,enabled)
    return <div ref={ref}><button data-hud-interactive onClick={clicked} onContextMenu={context}>功能</button><button>其他区域</button></div>
  }
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    return (this.tagName==='BUTTON' ? {left:900,top:800,right:950,bottom:850,width:50,height:50} : {left:0,top:0,right:1000,bottom:1000,width:1000,height:1000}) as DOMRect
  })
  const hit=vi.fn()
  Object.defineProperty(document,'elementFromPoint',{value:hit,configurable:true})
  const {rerender}=render(<Harness enabled />)
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('set_immersive_hotspots',expect.objectContaining({regions:[{x:.9,y:.8,w:expect.closeTo(.05),h:expect.closeTo(.05)}]})))
  const payload=native.invoke.mock.calls.at(-1)![1]
  hit.mockReturnValue(screen.getByRole('button',{name:'功能'}))
  const click=native.events.get('immersive-hud-click')!
  act(()=>click({generation:payload.generation-1,x:.92,y:.82}))
  expect(clicked).not.toHaveBeenCalled()
  act(()=>click({generation:payload.generation,x:.92,y:.82}))
  expect(clicked).toHaveBeenCalledTimes(1)
  act(()=>click({generation:payload.generation,x:.92,y:.82,button:'right'}))
  expect(context).toHaveBeenCalledTimes(1)
  expect(clicked).toHaveBeenCalledTimes(1)
  hit.mockReturnValue(screen.getByRole('button',{name:'其他区域'}))
  act(()=>click({generation:payload.generation,x:.92,y:.82}))
  expect(clicked).toHaveBeenCalledTimes(1)
  rerender(<Harness enabled={false} />)
  expect(native.invoke.mock.calls.at(-1)![1].regions).toEqual([])
  // Browser preview retains normal DOM activation as well.
  fireEvent.click(screen.getByRole('button',{name:'功能'}))
  expect(clicked).toHaveBeenCalledTimes(2)
})

it('relays native hold/release/cancel before activation and cancels on hide',async()=>{
  const sequence:string[]=[]
  function Harness({enabled=true}:{enabled?:boolean}) {
    const ref=useRef<HTMLDivElement>(null)
    useHudHotspots(ref,enabled)
    useMakaFeedback()
    return <div ref={ref}><button data-hud-interactive className="maka-state-button" onClick={()=>sequence.push('click')}
      onPointerDown={()=>sequence.push('down')} onPointerUp={()=>sequence.push('up')}><span className="maka-control-art">MAKA</span></button></div>
  }
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:100,bottom:100,width:100,height:100} as DOMRect)
  const view=render(<Harness />)
  const target=screen.getByRole('button')
  const art=target.firstElementChild as HTMLElement
  // React suppresses its synthetic events during layout-effect cleanup;
  // feedback uses a native listener and must still receive this cancellation.
  target.addEventListener('pointercancel',()=>sequence.push('cancel'))
  Object.defineProperty(document,'elementFromPoint',{value:()=>target,configurable:true})
  await waitFor(()=>expect(native.invoke).toHaveBeenCalled())
  const payload={generation:native.invoke.mock.calls.at(-1)![1].generation,x:.5,y:.5,button:'left' as const}
  const pointer=native.events.get('immersive-hud-pointer')
  expect(pointer).toBeTypeOf('function')
  act(()=>pointer!({...payload,phase:'down'}))
  expect(sequence).toEqual(['down'])
  expect(art.style.scale).toBe('1.1')
  act(()=>native.events.get('immersive-hud-click')!(payload))
  expect(sequence).toEqual(['down','up','click'])
  expect(art.style.scale).toBe('')
  act(()=>pointer!({...payload,phase:'down'}))
  act(()=>pointer!({...payload,phase:'cancel'}))
  expect(sequence.slice(-2)).toEqual(['down','cancel'])
  expect(art.style.scale).toBe('')
  act(()=>pointer!({...payload,generation:payload.generation-1,phase:'down'}))
  expect(sequence).toHaveLength(5)
  act(()=>pointer!({...payload,phase:'down'}))
  view.rerender(<Harness enabled={false} />)
  expect(sequence.slice(-2)).toEqual(['down','cancel'])
  expect(art.style.scale).toBe('')
})
