// ─────────────────────────────────────────────────────────────────────────────
//  calculations.js  ·  Smart Air Quality Monitor — Analytics & Utilities
// ─────────────────────────────────────────────────────────────────────────────

export function getSmokeLevel(adcRaw) {
  const pct = Math.round((adcRaw / 1023) * 100)
  let label, color
  if (pct < 20)      { label = 'Clean';    color = '#10b981' }
  else if (pct < 40) { label = 'Low';      color = '#86efac' }
  else if (pct < 60) { label = 'Moderate'; color = '#eab308' }
  else if (pct < 80) { label = 'High';     color = '#f97316' }
  else               { label = 'Danger';   color = '#ef4444' }
  return { pct, label, color }
}

export function getAQILevel(aqi) {
  if (aqi <= 50)  return { label: 'Good',                           color: '#10b981' }
  if (aqi <= 100) return { label: 'Moderate',                       color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy',                      color: '#ef4444' }
  if (aqi <= 300) return { label: 'Very Unhealthy',                 color: '#9333ea' }
  return                  { label: 'Hazardous',                     color: '#7c2d12' }
}

export function getNanoLevel(nano) {
  if (nano <= 50)  return { label: 'Low Risk',      color: '#10b981' }
  if (nano <= 100) return { label: 'Moderate Risk', color: '#eab308' }
  if (nano <= 150) return { label: 'Elevated',      color: '#f97316' }
  if (nano <= 200) return { label: 'High Risk',     color: '#ef4444' }
  if (nano <= 300) return { label: 'Very High',     color: '#9333ea' }
  return                   { label: 'Hazardous',    color: '#7c2d12' }
}

export function adcToCOppm(adc) {
  if (!adc || adc <= 0) return '0'
  const Vcc  = 5.0, RL = 10.0
  const Vout = (adc / 1023.0) * Vcc
  if (Vout <= 0.01) return '0'
  const Rs    = ((Vcc - Vout) / Vout) * RL
  const R0    = 10.0
  const ratio = Rs / R0
  const ppm   = 99.042 * Math.pow(ratio, -1.518)
  return Math.max(0, Math.min(10000, ppm)).toFixed(1)
}

function linearRegression(values) {
  const n = values.length
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 }
  const sumX  = values.reduce((s, _, i) => s + i, 0)
  const sumY  = values.reduce((s, v)    => s + v, 0)
  const sumXY = values.reduce((s, v, i) => s + i * v, 0)
  const sumX2 = values.reduce((s, _, i) => s + i * i, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope     = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

export function predictNext(historyArray, key) {
  if (!historyArray || historyArray.length < 3) return { value: null, trend: 'stable', pct: '0.0' }
  const last5   = historyArray.slice(-5).map(r => r[key] || 0)
  const weights = [0.10, 0.15, 0.20, 0.25, 0.30]
  const wma     = last5.reduce((sum, v, i) => sum + v * (weights[weights.length - last5.length + i] ?? 0.2), 0)
  const oldest = last5[0], newest = last5[last5.length - 1]
  const pct    = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0
  const trend  = pct > 2 ? 'rising' : pct < -2 ? 'falling' : 'stable'
  const projected = wma + (pct / 100) * wma * 0.15
  return { value: Math.max(0, Math.min(500, projected)).toFixed(1), trend, pct: pct.toFixed(1) }
}

// ─── 24-Hour Timeline Forecast (Fallback when AI is not trained yet) ─────────
export function forecast24Hours(historyArray, key) {
  if (!historyArray || historyArray.length < 5) return []

  const source = historyArray.slice(-20).map(r => Number(r[key]) || 0)
  const { slope, intercept } = linearRegression(source)

  const residuals = source.map((v, i) => v - (intercept + slope * i))
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / source.length)
  const lastVal = source[source.length - 1]

  return Array.from({ length: 24 }, (_, i) => {
    // Dampen the slope so it stabilizes over 24h
    const dampedSlope = slope * Math.pow(0.92, i)
    let rawProj = lastVal + (dampedSlope * (i + 1))
    
    // Add a synthetic daily air quality wave (peaks/valleys)
    const dailyCycle = Math.sin(((i + 1) / 24) * Math.PI * 2) * 5
    const value = rawProj + dailyCycle

    const conf = rmse * Math.sqrt(i + 1) * 1.5   
    return {
      step:       i + 1,
      label:      `+${i + 1}h`,
      value:      +Math.max(0, Math.min(500, value)).toFixed(1),
      upper:      +Math.max(0, Math.min(500, value + conf)).toFixed(1),
      lower:      +Math.max(0, Math.min(500, value - conf)).toFixed(1),
      isForecast: true
    }
  })
}

export function getHealthRecommendations(aqi, nano, smokePct, coPpm) {
  const recs  = [], coNum = parseFloat(coPpm) || 0
  if (aqi > 300) recs.push({ severity: 'critical', icon: '🚨', text: 'Hazardous air quality — stay indoors immediately, seal windows and doors', category: 'AQI' })
  else if (aqi > 200) { recs.push({ severity: 'critical', icon: '😷', text: 'Very unhealthy air — everyone should avoid all outdoor physical activity', category: 'AQI' }); recs.push({ severity: 'danger', icon: '🏠', text: 'Keep all windows and doors closed; use air purifier if available', category: 'AQI' }) }
  else if (aqi > 150) { recs.push({ severity: 'danger', icon: '😷', text: 'Wear an N95 or KN95 respirator mask when going outdoors', category: 'AQI' }); recs.push({ severity: 'warning', icon: '🚶', text: 'Avoid prolonged or strenuous outdoor activities', category: 'AQI' }) }
  else if (aqi > 100) recs.push({ severity: 'warning', icon: '👶', text: 'Sensitive groups (children, elderly, asthmatic) should limit outdoor time', category: 'AQI' })
  else if (aqi > 50) recs.push({ severity: 'info', icon: '😐', text: 'Air is acceptable — unusually sensitive individuals may want to limit exertion', category: 'AQI' })
  else recs.push({ severity: 'good', icon: '✅', text: 'Air quality is satisfactory — outdoor activities are safe for everyone', category: 'AQI' })

  if (nano > 200) recs.push({ severity: 'danger', icon: '🔬', text: 'High nanoparticle concentration — N95 mask strongly recommended', category: 'Nano' })
  else if (nano > 150) recs.push({ severity: 'warning', icon: '🔬', text: 'Elevated nanoparticle levels — fine-particle respirator advisable outdoors', category: 'Nano' })

  if (smokePct > 80) recs.push({ severity: 'critical', icon: '🔥', text: 'Dangerous smoke or combustion gas — evacuate if unknown source', category: 'Smoke' })
  else if (smokePct > 60) recs.push({ severity: 'danger', icon: '💨', text: 'High smoke detected — open windows and ventilate area immediately', category: 'Smoke' })
  else if (smokePct > 40) recs.push({ severity: 'warning', icon: '⚠️', text: 'Moderate smoke levels — check for nearby combustion sources', category: 'Smoke' })

  if (coNum > 200) recs.push({ severity: 'critical', icon: '☠️', text: 'Dangerous carbon monoxide levels — evacuate area and call emergency services', category: 'CO' })
  else if (coNum > 70) recs.push({ severity: 'danger', icon: '⚡', text: 'Elevated CO — headaches and dizziness possible; increase ventilation', category: 'CO' })
  else if (coNum > 35) recs.push({ severity: 'warning', icon: '💨', text: 'Slightly elevated CO — improve ventilation and check combustion appliances', category: 'CO' })

  if (recs.length === 0) recs.push({ severity: 'good', icon: '🌿', text: 'All air quality parameters are within safe limits — no precautions required', category: 'General' })
  return recs
}

export function detectAnomaly(historyArray, key, currentValue) {
  if (!historyArray || historyArray.length < 10) return { isAnomaly: false }
  const values   = historyArray.slice(-20).map(r => Number(r[key]) || 0)
  const mean     = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length
  const stdDev   = Math.sqrt(variance)
  const current  = Number(currentValue) || 0
  const zScore   = stdDev > 0 ? (current - mean) / stdDev : 0

  if (Math.abs(zScore) > 3
