export function getAQILevel(aqi) {
  if (aqi <= 50)  return { label: 'Good',           color: '#22c55e' }
  if (aqi <= 100) return { label: 'Moderate',       color: '#eab308' }
  if (aqi <= 150) return { label: 'Unhealthy',      color: '#f97316' }
  if (aqi <= 200) return { label: 'Very Unhealthy', color: '#ef4444' }
  return                  { label: 'Hazardous',     color: '#7c3aed' }
}

export function getNanoLevel(nano) {
  if (nano <= 50)  return { label: 'Low',      color: '#22c55e' }
  if (nano <= 100) return { label: 'Moderate', color: '#eab308' }
  if (nano <= 200) return { label: 'High',     color: '#f97316' }
  return                   { label: 'Critical', color: '#ef4444' }
}

export function predictNext(historyArray, key) {
  if (!historyArray || historyArray.length < 3) return null
  const last3   = historyArray.slice(-3).map(r => r[key])
  const weights = [0.2, 0.3, 0.5]
  const wma     = last3.reduce((sum, v, i) => sum + v * weights[i], 0)
  const trend   = (last3[2] - last3[0]) / 2
  return Math.max(0, Math.min(500, wma + trend * 0.3)).toFixed(1)
}