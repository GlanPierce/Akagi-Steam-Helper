import type { ImmersiveFrame } from './types'
export class FrameGate {
  private minimum = 0
  private accepted = -1
  accept(frame: ImmersiveFrame): ImmersiveFrame | null {
    if (frame.revision < Math.max(this.minimum, this.accepted)) return null
    this.accepted = frame.revision
    const live = frame.capture.state === 'running' && frame.transport_connected !== false && frame.game && !frame.game.is_done
    return { ...frame,
      response: live && frame.can_act && frame.response?.meta?.akagi_revision === frame.revision ? frame.response : null,
      analysis: live && frame.analysis?.revision === frame.revision ? frame.analysis : null }
  }
  invalidate(revision = this.accepted + 1): boolean {
    this.minimum = Math.max(this.minimum, revision)
    return this.accepted < this.minimum
  }
}
