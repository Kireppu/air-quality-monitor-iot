// MQ-2 ADC → percentage + level
export function getSmokeLevel(adcRaw) {
  const pct = Math.round((adcRaw / 1023) * 100)
  let label, color
  if (pct < 20)       { label = 'Clean';    color = '#22c55e' }
  else if (pct < 40)  { label = 'Low';      color = '#86efac' }
  else if (pct < 60)  { label = 'Moderate'; color = '#eab308' }
  else if (pct < 80)  { label = 'High';     color = '#f97316' }
  else                { label = 'Danger';   color = '#ef4444' }
  return { pct, label, color }
}

// ─── AQI Level Labels ────────────────────────────────────────────────────────
export function getAQILevel(aqi) {
  if (aqi <= 50)  return { label: 'Good',                            color: '#22c55e' }
  if (aqi <= 100) return { label: 'Moderate',                        color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups',  color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy',                       color: '#ef4444' }
  if (aqi <= 300) return { label: 'Very Unhealthy',                  color: '#9333ea' }
  return                  { label: 'Hazardous',                      color: '#7c2d12' }
}

// ─── Nano Index Level Labels (aligned to AQI scale) ─────────────────────────
export function getNanoLevel(nano) {
  if (nano <= 50)  return { label: 'Low Risk',      color: '#22c55e' }
  if (nano <= 100) return { label: 'Moderate Risk', color: '#eab308' }
  if (nano <= 150) return { label: 'Elevated',      color: '#f97316' }
  if (nano <= 200) return { label: 'High Risk',     color: '#ef4444' }
  if (nano <= 300) return { label: 'Very High',     color: '#9333ea' }
  return                   { label: 'Hazardous',    color: '#7c2d12' }
}

// ─── Rolling Average AQI ─────────────────────────────────────────────────────
// Averages the last 10 readings to smooth out instantaneous spikes,
// approximating how standard AQI time-weighted averages work
export function rollingAQI(historyArray) {
  if (!historyArray || historyArray.length === 0) return null
  const last10 = historyArray.slice(-10)
  const avg    = last10.reduce((sum, r) => sum + (r.aqi || 0), 0) / last10.length
  return Math.round(avg)
}

// ─── MQ-7 ADC → CO ppm (approximate) ────────────────────────────────────────
// Based on MQ-7 datasheet sensitivity curve:
//   Rs/R0 in clean air ≈ 27.5
//   Characteristic: ppm ≈ 99.042 * (Rs/R0)^-1.518
// NOTE: Accuracy improves with proper R0 calibration in clean outdoor air
export function adcToCOppm(adc) {
  if (!adc || adc <= 0) return '0'
  const Vcc   = 5.0
  const RL    = 10.0                         // load resistor in kΩ (typical MQ-7 board)
  const Vout  = (adc / 1023.0) * Vcc
  if (Vout <= 0.01) return '0'
  const Rs    = ((Vcc - Vout) / Vout) * RL  // sensor resistance in kΩ
  const R0    = 10.0                         // assumed clean-air R0 in kΩ
  const ratio = Rs / R0
  const ppm   = 99.042 * Math.pow(ratio, -1.518)
  return Math.max(0, Math.min(10000, ppm)).toFixed(1)
}

// ─── Nano Index Prediction ───────────────────────────────────────────────────
// 5-point weighted moving average with trend projection
// Returns: predicted value, trend direction, and % change
export function predictNext(historyArray, key) {
  if (!historyArray || historyArray.length < 3) {
    return { value: null, trend: 'stable', pct: '0.0' }
  }

  const last5   = historyArray.slice(-5).map(r => r[key] || 0)
  const weights = [0.10, 0.15, 0.20, 0.25, 0.30]
  const wma     = last5.reduce((sum, v, i) => {
    const w = weights[weights.length - last5.length + i]
    return sum + v * (w || 0.2)
  }, 0)

  const oldest    = last5[0]
  const newest    = last5[last5.length - 1]
  const pct       = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0
  const trend     = pct >  2 ? 'rising'
                  : pct < -2 ? 'falling'
                  :             'stable'

  const projected = wma + (pct / 100) * wma * 0.15
  return {
    value: Math.max(0, Math.min(500, projected)).toFixed(1),
    trend,
    pct: pct.toFixed(1)
  }
}
