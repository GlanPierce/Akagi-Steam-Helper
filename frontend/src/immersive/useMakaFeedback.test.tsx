import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mockMatchMedia } from '@/testing/setup'
import { useMakaFeedback } from './useMakaFeedback'

const animate = vi.fn()
function Harness({disabled=false}:{disabled?:boolean}) {
  useMakaFeedback()
  return <button className="maka-state-button" data-hud-interactive disabled={disabled}>
    <span className="maka-control-art">MAKA</span>
  </button>
}
function MenuHarness() {
  useMakaFeedback()
  return <div className="maka-menu-open">
    <nav className="hud-drawer-tabs"><a href="#model"><span>模型</span></a></nav>
    <button>筛选</button>
    <button data-native-press-scale><span className="maka-control-art">返回</span></button>
  </div>
}
beforeEach(()=>{
  mockMatchMedia(false)
  animate.mockReset().mockImplementation(()=>({cancel:vi.fn(),onfinish:null}))
  Object.defineProperty(HTMLElement.prototype,'animate',{value:animate,configurable:true})
})
afterEach(()=>vi.restoreAllMocks())

it('keeps the art enlarged throughout a held press and restores it without moving the hit box',()=>{
  const {unmount}=render(<Harness />)
  const button=screen.getByRole('button')
  const art=button.firstElementChild as HTMLElement
  fireEvent(button,new MouseEvent('pointerdown',{bubbles:true,button:0}))
  expect(art.style.scale).toBe('1.1')
  expect(button.style.scale).toBe('')
  expect(animate).not.toHaveBeenCalled()
  fireEvent(document,new MouseEvent('pointerup',{bubbles:true,button:0}))
  expect(art.style.scale).toBe('')
  expect(animate).toHaveBeenCalledTimes(1)
  fireEvent.click(button)
  expect(animate).toHaveBeenCalledTimes(1) // release is the feedback, no second pulse
  unmount()
  expect(animate.mock.results[0].value.cancel).toHaveBeenCalled()
})

it.each(['pointercancel','blur','unmount'])('clears a held press on %s',reason=>{
  const {unmount}=render(<Harness />)
  const art=screen.getByRole('button').firstElementChild as HTMLElement
  fireEvent(art,new MouseEvent('pointerdown',{bubbles:true,button:0}))
  expect(art.style.scale).toBe('1.1')
  if(reason==='unmount') unmount()
  else fireEvent(reason==='blur' ? window : document,new Event(reason,{bubbles:true}))
  expect(art.style.scale).toBe('')
})

it('keeps disabled controls still and retains feedback for keyboard/native context activation',()=>{
  const {rerender}=render(<Harness disabled />)
  const button=screen.getByRole('button')
  const art=button.firstElementChild as HTMLElement
  fireEvent(art,new MouseEvent('pointerdown',{bubbles:true,button:0}))
  expect(art.style.scale).toBe('')
  rerender(<Harness />)
  fireEvent.click(button)
  fireEvent.contextMenu(button)
  expect(animate).toHaveBeenCalledTimes(2)
})

it('does not enlarge native menu tabs or ordinary menu controls on hold or activation',()=>{
  render(<MenuHarness />)
  for(const label of ['模型','筛选']) {
    const target=screen.getByText(label)
    const button=target.closest('a,button') as HTMLElement
    fireEvent(target,new MouseEvent('pointerdown',{bubbles:true,button:0}))
    expect(button.style.scale).toBe('')
    expect(target.style.scale).toBe('')
    fireEvent(document,new MouseEvent('pointerup',{bubbles:true,button:0}))
    fireEvent.click(button)
    expect(animate).not.toHaveBeenCalled()
  }
})

it('retains held feedback for the menu controls whose native prefab enables it',()=>{
  render(<MenuHarness />)
  const art=screen.getByText('返回')
  fireEvent(art,new MouseEvent('pointerdown',{bubbles:true,button:0}))
  expect(art.style.scale).toBe('1.1')
  expect(art.parentElement!.style.scale).toBe('')
  fireEvent(document,new MouseEvent('pointerup',{bubbles:true,button:0}))
  expect(art.style.scale).toBe('')
})
