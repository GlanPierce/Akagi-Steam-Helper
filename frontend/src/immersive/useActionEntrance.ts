import { useEffect, useState } from 'react'

/** The game's operation buttons slide into their fixed dock before labels show.
 * The clock begins with the legal prompt, not with a model response refresh. */
export function useActionEntrance(key: string) {
  const [ready,setReady] = useState('')
  useEffect(() => {
    if (!key) { setReady(''); return }
    const timer = window.setTimeout(() => setReady(key),460)
    return () => window.clearTimeout(timer)
  },[key])
  return !!key && ready === key
}
