import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'mahgen'
import './index.css'
import './i18n'
import { Overlay } from '@/routes/Overlay'

const root = createRoot(document.getElementById('root')!)
if (import.meta.env.DEV && new URLSearchParams(location.search).has('immersivePreview')) {
  void import('@/immersive/Preview').then(({ Preview }) => root.render(<Preview />))
} else {
  document.documentElement.classList.add('overlay-window')
  root.render(<StrictMode><Overlay /></StrictMode>)
}
