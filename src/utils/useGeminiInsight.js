// ─────────────────────────────────────────────────────────────────────────────
//  useGeminiInsights.js  ·  Smart Air Quality Monitor — Gemini AI Hook
//  Calls Google Gemini 2.0 Flash for context-aware health advisories.
//  Rate-limited: fires on first reading, then only on significant changes
//  or after 60 s of unchanged data. Returns same shape as getHealthRecommendations().
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react'

const HARD_MIN_MS  = 15_000   // absolute floor between any two calls
const STABLE_MS    = 60_000   // call again after 60 s even if readings are stable
const AQI_DELTA    = 10       // AQI change that counts as "significant"
const NANO_DELTA   = 15       // Nano Index change
const SMOKE_DELTA  = 12       // smoke % change

export function useGeminiInsights(apiKey, currentReading, anomalies) {
  const [insights, setInsights] = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Refs so the effect callback always sees the latest values
  // without needing them in the dependency array
  const anomaliesRef  = useRef(anomalies)
  const lastCallRef   = useRef(0)
  const lastAqiRef    = useRef(null)
  const lastNanoRef   = useRef(null)
  const lastSmokeRef  = useRef(null)

  // Keep anomalies ref fresh on every render
  useEffect(() => { anomaliesRef.current = anomalies }, [anomalies])

  useEffect(() => {
    if (!apiKey || !currentReading) return

    const now       = Date.now()
    const elapsed   = now - lastCallRef.current
    const neverRan  = lastCallRef.current === 0

    // Compute deltas against last-call snapshot
    const aqiDelta   = Math.abs((currentReading.aqi        ?? 0) - (lastAqiRef.current   ?? 0))
    const nanoDelta  = Math.abs((currentReading.nano_index  ?? 0) - (lastNanoRef.current  ?? 0))
    const smokeDelta = Math.abs((currentReading.smoke_pct   ?? 0) - (lastSmokeRef.current ?? 0))
    const bigChange  = aqiDelta > AQI_DELTA || nanoDelta > NANO_DELTA || smokeDelta > SMOKE_DELTA

    // Guard: never call faster than HARD_MIN_MS
    if (!neverRan && elapsed < HARD_MIN_MS) return
    // Guard: if readings are stable, call only on STABLE_MS cadence
    if (!neverRan && !bigChange && elapsed < STABLE_MS) return

    // Snapshot the trigger values
    lastCallRef.current   = now
    lastAqiRef.current    = currentReading.aqi
    lastNanoRef.current   = currentReading.nano_index
    lastSmokeRef.current  = currentReading.smoke_pct

    const call = async () => {
      setLoading(true)
      setError(null)

      try {
        const anomalyLines = (anomaliesRef.current ?? [])
          .filter(a => a.isAnomaly)
          .map(a => `  - ${a.sensor}: ${a.message}`)
          .join('\n') || '  None detected'

        const prompt = `You are an expert air quality health advisor for a real-time IoT sensor system in the Philippines (tropical climate, Metro Manila context).

Current sensor readings:
  - AQI (US EPA scale): ${Math.round(currentReading.aqi ?? 0)}
  - PM2.5: ${(currentReading.pm25_ug ?? 0).toFixed(1)} µg/m³
  - Nano Index: ${Math.round(currentReading.nano_index ?? 0)}
  - CO (estimated): ${(currentReading.co_ppm ?? 0).toFixed(1)} ppm
  - Smoke / Gas: ${Math.round(currentReading.smoke_pct ?? 0)}%
  - Temperature: ${currentReading.temperature ?? '--'}°C
  - Humidity: ${currentReading.humidity ?? '--'}% RH
Active anomalies:
${anomalyLines}

Task: Return exactly 3 to 4 health recommendations tailored to these readings.

Rules:
  1. Be specific and actionable — avoid vague generic advice.
  2. Account for the Philippine tropical climate (high humidity, heat stress, traffic emissions).
  3. Keep each "text" field concise (under 120 characters).
  4. Use only these severity values: good | info | warning | danger | critical
  5. Respond ONLY with a raw JSON array — no markdown code fences, no explanation text, nothing else.

Response format:
[{"severity":"<level>","icon":"<single emoji>","text":"<actionable advice>","category":"<AQI|PM2.5|CO|Smoke|Nano|General>"}]`

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              contents:         [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.25, maxOutputTokens: 700 }
            })
          }
        )

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
        }

        const data    = await res.json()
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
        const clean   = rawText.replace(/```json|```/g, '').trim()
        const parsed  = JSON.parse(clean)

        if (Array.isArray(parsed) && parsed.length > 0) {
          setInsights(parsed)
        } else {
          throw new Error('Gemini returned an empty or non-array response')
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    call()

  // Only re-trigger when the key or the meaningful primitives change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, currentReading?.aqi, currentReading?.nano_index, currentReading?.smoke_pct])

  return { insights, loading, error }
}
