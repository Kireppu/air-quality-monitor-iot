// ─────────────────────────────────────────────────────────────────────────────
//  calculations.js  ·  Smart Air Quality Monitor — Analytics & Utilities
// ─────────────────────────────────────────────────────────────────────────────

// ─── MQ-2 ADC → percentage + level ──────────────────────────────────────────
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

// ─── AQI Level Labels (US EPA scale) ────────────────────────────────────────
export function getAQILevel(aqi) {
  if (aqi <= 50)  return { label: 'Good',                           color: '#10b981' }
  if (aqi <= 100) return { label: 'Moderate',                       color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#f97316' }
  if (aqi <= 200) return { label: 'Unhealthy',                      color: '#ef4444' }
  if (aqi <= 300) return { label: 'Very Unhealthy',                 color: '#9333ea' }
  return                  { label: 'Hazardous',                     color: '#7c2d12' }
}

// ─── Nano Index Level Labels ─────────────────────────────────────────────────
export function getNanoLevel(nano) {
  if (nano <= 50)  return { label: 'Low Risk',      color: '#10b981' }
  if (nano <= 100) return { label: 'Moderate Risk', color: '#eab308' }
  if (nano <= 150) return { label: 'Elevated',      color: '#f97316' }
  if (nano <= 200) return { label: 'High Risk',     color: '#ef4444' }
  if (nano <= 300) return { label: 'Very High',     color: '#9333ea' }
  return                   { label: 'Hazardous',    color: '#7c2d12' }
}

// ─── MQ-7 ADC → CO ppm (approximate) ────────────────────────────────────────
// Based on MQ-7 datasheet sensitivity curve:
//   Rs/R0 in clean air ≈ 27.5  |  ppm ≈ 99.042 × (Rs/R0)^−1.518
export function adcToCOppm(adc) {
  if (!adc || adc <= 0) return '0'
  const Vcc  = 5.0
  const RL   = 10.0
  const Vout = (adc / 1023.0) * Vcc
  if (Vout <= 0.01) return '0'
  const Rs    = ((Vcc - Vout) / Vout) * RL
  const R0    = 10.0
  const ratio = Rs / R0
  const ppm   = 99.042 * Math.pow(ratio, -1.518)
  return Math.max(0, Math.min(10000, ppm)).toFixed(1)
}

// ─── Internal: Simple Linear Regression ──────────────────────────────────────
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

// ─── 5-Point WMA Prediction (single next step) ───────────────────────────────
export function predictNext(historyArray, key) {
  if (!historyArray || historyArray.length < 3)
    return { value: null, trend: 'stable', pct: '0.0' }

  const last5   = historyArray.slice(-5).map(r => r[key] || 0)
  const weights = [0.10, 0.15, 0.20, 0.25, 0.30]
  const wma     = last5.reduce((sum, v, i) => {
    const w = weights[weights.length - last5.length + i]
    return sum + v * (w ?? 0.2)
  }, 0)

  const oldest = last5[0]
  const newest = last5[last5.length - 1]
  const pct    = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0
  const trend  = pct > 2 ? 'rising' : pct < -2 ? 'falling' : 'stable'

  const projected = wma + (pct / 100) * wma * 0.15
  return {
    value: Math.max(0, Math.min(500, projected)).toFixed(1),
    trend,
    pct: pct.toFixed(1)
  }
}

// ─── Multi-Step Timeline Forecast ────────────────────────────────────────────
// Uses OLS linear regression on last 15 readings.
// Returns `steps` projected data-points with widening confidence intervals.
// Each object: { step, label, value, upper, lower, isForecast }
export function forecastTimeline(historyArray, key, steps = 6) {
  if (!historyArray || historyArray.length < 5) return []

  const source = historyArray.slice(-15).map(r => Number(r[key]) || 0)
  const { slope, intercept } = linearRegression(source)

  // Residual RMSE → drives confidence interval width
  const residuals = source.map((v, i) => v - (intercept + slope * i))
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / source.length)

  const lastIdx = source.length - 1
  const lastVal = source[lastIdx]

  return Array.from({ length: steps }, (_, i) => {
    const projIdx   = lastIdx + i + 1
    const rawProj   = intercept + slope * projIdx
    // Light damping: blend raw projection toward last known value with distance decay
    const weight    = 1 - Math.exp(-0.18 * (i + 1))
    const value     = lastVal + (rawProj - lastVal) * weight
    const conf      = rmse * Math.sqrt(i + 1) * 1.65   // ~90% confidence interval
    return {
      step:       i + 1,
      label:      `+${i + 1}`,
      value:      +Math.max(0, Math.min(500, value)).toFixed(1),
      upper:      +Math.max(0, Math.min(500, value + conf)).toFixed(1),
      lower:      +Math.max(0, Math.min(500, value - conf)).toFixed(1),
      isForecast: true
    }
  })
}

// ─── Health Recommendations ───────────────────────────────────────────────────
// severity: 'good' | 'info' | 'warning' | 'danger' | 'critical'
export function getHealthRecommendations(aqi, nano, smokePct, coPpm) {
  const recs  = []
  const coNum = parseFloat(coPpm) || 0

  // AQI-based advisories
  if (aqi > 300) {
    recs.push({ severity: 'critical', icon: '🚨', text: 'Hazardous air quality — stay indoors immediately, seal windows and doors', category: 'AQI' })
  } else if (aqi > 200) {
    recs.push({ severity: 'critical', icon: '😷', text: 'Very unhealthy air — everyone should avoid all outdoor physical activity', category: 'AQI' })
    recs.push({ severity: 'danger',   icon: '🏠', text: 'Keep all windows and doors closed; use air purifier if available', category: 'AQI' })
  } else if (aqi > 150) {
    recs.push({ severity: 'danger',   icon: '😷', text: 'Wear an N95 or KN95 respirator mask when going outdoors', category: 'AQI' })
    recs.push({ severity: 'warning',  icon: '🚶', text: 'Avoid prolonged or strenuous outdoor activities', category: 'AQI' })
  } else if (aqi > 100) {
    recs.push({ severity: 'warning',  icon: '👶', text: 'Sensitive groups (children, elderly, asthmatic) should limit outdoor time', category: 'AQI' })
  } else if (aqi > 50) {
    recs.push({ severity: 'info',     icon: '😐', text: 'Air is acceptable — unusually sensitive individuals may want to limit exertion', category: 'AQI' })
  } else {
    recs.push({ severity: 'good',     icon: '✅', text: 'Air quality is satisfactory — outdoor activities are safe for everyone', category: 'AQI' })
  }

  // Nanoparticle-based advisories
  if (nano > 200) {
    recs.push({ severity: 'danger',  icon: '🔬', text: 'High nanoparticle concentration — N95 mask strongly recommended; limit time in area', category: 'Nano' })
  } else if (nano > 150) {
    recs.push({ severity: 'warning', icon: '🔬', text: 'Elevated nanoparticle levels — fine-particle respirator advisable outdoors', category: 'Nano' })
  }

  // Smoke / gas-based advisories
  if (smokePct > 80) {
    recs.push({ severity: 'critical', icon: '🔥', text: 'Dangerous smoke or combustion gas — identify source immediately; evacuate if unknown', category: 'Smoke' })
  } else if (smokePct > 60) {
    recs.push({ severity: 'danger',  icon: '💨', text: 'High smoke detected — open windows and ventilate area immediately', category: 'Smoke' })
  } else if (smokePct > 40) {
    recs.push({ severity: 'warning', icon: '⚠️', text: 'Moderate smoke levels — check for nearby combustion sources', category: 'Smoke' })
  }

  // CO-based advisories
  if (coNum > 200) {
    recs.push({ severity: 'critical', icon: '☠️', text: 'Dangerous carbon monoxide levels — evacuate area and call emergency services', category: 'CO' })
  } else if (coNum > 70) {
    recs.push({ severity: 'danger',  icon: '⚡', text: 'Elevated CO — headaches and dizziness possible; increase ventilation immediately', category: 'CO' })
  } else if (coNum > 35) {
    recs.push({ severity: 'warning', icon: '💨', text: 'Slightly elevated CO — improve ventilation and check combustion appliances', category: 'CO' })
  }

  if (recs.length === 0) {
    recs.push({ severity: 'good', icon: '🌿', text: 'All air quality parameters are within safe limits — no precautions required', category: 'General' })
  }

  return recs
}

// ─── Anomaly Detection (Z-score method) ──────────────────────────────────────
// Uses the last 20 readings to compute a rolling mean and std deviation.
// A |z-score| > 2 is flagged as unusual; > 3 as extreme.
export function detectAnomaly(historyArray, key, currentValue) {
  if (!historyArray || historyArray.length < 10) return { isAnomaly: false }

  const values   = historyArray.slice(-20).map(r => Number(r[key]) || 0)
  const mean     = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length
  const stdDev   = Math.sqrt(variance)
  const current  = Number(currentValue) || 0
  const zScore   = stdDev > 0 ? (current - mean) / stdDev : 0

  if (Math.abs(zScore) > 3) return {
    isAnomaly: true, severity: 'critical',
    zScore:    +zScore.toFixed(1),
    message:   `Extreme spike: ${current.toFixed(0)} (${Math.abs(zScore).toFixed(1)}σ from recent mean ${mean.toFixed(0)})`
  }
  if (Math.abs(zScore) > 2) return {
    isAnomaly: true, severity: 'warning',
    zScore:    +zScore.toFixed(1),
    message:   `Unusual reading: ${current.toFixed(0)} (${Math.abs(zScore).toFixed(1)}σ from recent mean ${mean.toFixed(0)})`
  }
  return { isAnomaly: false, zScore: +zScore.toFixed(1) }
}

// ─── Sensor Statistics (min / max / avg / trend) ─────────────────────────────
// Compares first-half average vs second-half average to determine direction.
export function getSensorStats(historyArray, key) {
  if (!historyArray || historyArray.length === 0) return null
  const values = historyArray.map(r => Number(r[key])).filter(v => !isNaN(v) && v >= 0)
  if (values.length === 0) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((s, v) => s + v, 0) / values.length

  const mid           = Math.floor(values.length / 2)
  const firstHalfAvg  = values.slice(0, mid).reduce((s, v) => s + v, 0) / (mid || 1)
  const secondHalfAvg = values.slice(mid).reduce((s, v) => s + v, 0) / ((values.length - mid) || 1)
  const trendPct      = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0

  return {
    min:      +min.toFixed(1),
    max:      +max.toFixed(1),
    avg:      +avg.toFixed(1),
    trend:    trendPct > 3 ? 'rising' : trendPct < -3 ? 'falling' : 'stable',
    trendPct: +trendPct.toFixed(1)
  }
}

// ─── CSV Report Generator ─────────────────────────────────────────────────────
// Produces a complete comma-separated log of all history readings.
export function generateCSV(historyArray) {
  if (!historyArray || historyArray.length === 0) return ''
  const headers = [
    'Timestamp (ISO)', 'AQI', 'Nano Index',
    'PM2.5 (µg/m³)', 'Temperature (°C)', 'Humidity (%)',
    'CO ADC', 'CO (ppm est.)', 'Smoke ADC', 'Smoke (%)'
  ]
  const rows = historyArray.map(r => [
    new Date((r.timestamp || 0) * 1000).toISOString(),
    Math.round(r.aqi        || 0),
    Math.round(r.nano_index || 0),
    ((r.pm25 || 0) * 1000).toFixed(2),
    r.temperature || 0,
    r.humidity    || 0,
    r.co          || 0,
    adcToCOppm(r.co),
    r.smoke       || 0,
    Math.round(((r.smoke || 0) / 1023) * 100)
  ])
  return [headers, ...rows].map(row => row.join(',')).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  TensorFlow.js Neural Network Prediction
// ─────────────────────────────────────────────────────────────────────────────
//  Trains a lightweight 2-hidden-layer dense network on the last N sensor
//  readings entirely in the browser — no server or cloud training required.
//
//  Architecture:
//    Input (window=5) → Dense(16, ReLU) → Dropout(0.1) → Dense(8, ReLU) → Dense(1)
//
//  Usage:  npm install @tensorflow/tfjs
//  Returns an array of { step, label, value, isForecast } objects,
//  or [] if TF.js is not installed or there is insufficient data.
// ─────────────────────────────────────────────────────────────────────────────
export async function trainAndPredictTF(historyArray, key, steps = 6) {
  // Dynamic import so the rest of the module loads even without TF.js installed
  let tf
  try {
    const mod = await import('@tensorflow/tfjs')
    tf = mod.default ?? mod
  } catch {
    console.warn('[trainAndPredictTF] @tensorflow/tfjs not found — run: npm install @tensorflow/tfjs')
    return []
  }

  if (!historyArray || historyArray.length < 10) return []

  // ── Normalise to [0, 1] ────────────────────────────────────────────────────
  const raw  = historyArray.map(r => Number(r[key]) || 0)
  const minV = Math.min(...raw)
  const maxV = Math.max(...raw)
  const rng  = maxV - minV || 1
  const norm = raw.map(v => (v - minV) / rng)

  // ── Build sliding-window pairs (X → y) ────────────────────────────────────
  const WINDOW = 5
  const xs = [], ys = []
  for (let i = 0; i <= norm.length - WINDOW - 1; i++) {
    xs.push(norm.slice(i, i + WINDOW))
    ys.push(norm[i + WINDOW])
  }
  if (xs.length < 3) return []

  const xT = tf.tensor2d(xs)
  const yT = tf.tensor1d(ys)

  // ── Model definition ───────────────────────────────────────────────────────
  const model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [WINDOW], units: 16, activation: 'relu' }),
      tf.layers.dropout({ rate: 0.1 }),
      tf.layers.dense({ units: 8, activation: 'relu' }),
      tf.layers.dense({ units: 1 })
    ]
  })
  model.compile({ optimizer: tf.train.adam(0.015), loss: 'meanSquaredError' })

  // ── Training (silent, no UI blocking) ─────────────────────────────────────
  await model.fit(xT, yT, {
    epochs:  80,
    verbose: 0,
    shuffle: false          // preserve temporal order
  })

  // ── Autoregressive multi-step prediction ──────────────────────────────────
  let window  = [...norm.slice(-WINDOW)]
  const results = []

  for (let i = 0; i < steps; i++) {
    const inT    = tf.tensor2d([window])
    const outT   = model.predict(inT)
    const pNorm  = Math.max(0, Math.min(1, outT.dataSync()[0]))
    const pVal   = pNorm * rng + minV       // denormalise

    results.push({
      step:       i + 1,
      label:      `+${i + 1}`,
      value:      +Math.max(0, Math.min(500, pVal)).toFixed(1),
      isForecast: true
    })

    // Feed prediction back as next input (autoregressive)
    window = [...window.slice(1), pNorm]
    tf.dispose([inT, outT])
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  tf.dispose([xT, yT, model])
  return results
}
