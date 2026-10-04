import { cn } from '@/lib/utils'

// Preserve the component API used by the original dashboard routes.
export function AkagiIcon({className}: {className?:string}) {
  return <span className={cn('inline-flex shrink-0',className)}><img src="/maka/common/maka_match_analysis_button_close.png" alt="" className="h-full w-auto" /></span>
}
export function AkagiWordmark({className}: {className?:string}) {
  return <span className={cn('inline-flex shrink-0 items-center gap-2',className)} aria-label="MAKA INGAME"><AkagiIcon className="h-full" /><span className="font-semibold tracking-wider whitespace-nowrap text-base">MAKA INGAME</span></span>
}
