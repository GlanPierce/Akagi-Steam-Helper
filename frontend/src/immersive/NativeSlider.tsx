type Props = {
  label: string
  value: number
  min: number
  max: number
  step: number
  percent?: boolean
  onChange: (value: number) => void
}

export function NativeSlider({ label, value, min, max, step, percent, onChange }: Props) {
  const display = percent ? `${Math.round(value * 10000) / 100}%` : String(value)
  const filled = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return <span className="hud-slider-control">
    <span className="hud-native-slider">
      <span className="hud-native-slider-track" aria-hidden="true"><span className="hud-native-slider-fill" style={{ width: `${filled * 100}%` }} /></span>
      <input aria-label={label} aria-valuetext={display} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(event.target.valueAsNumber)} />
    </span>
    <output aria-hidden="true">{display}</output>
  </span>
}
