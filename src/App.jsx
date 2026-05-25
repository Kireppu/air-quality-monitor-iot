// ─────────────────────────────────────────────────────────────────────────────
//  App.jsx  ·  Smart Air Quality Monitor — Enhanced Dashboard
//  Features: Timeline Forecast · Health Advisories · All-Sensor Charts
//            Session Analytics · Anomaly Detection · CSV Export
//            🤖 AI Tab: TensorFlow.js Neural Network + Google Gemini 2.0 Flash
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { ref, onValue, query, limitToLast }                   from 'firebase/database'
import { db }                                                  from './firebase'
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import {
  getAQILevel, getNanoLevel, predictNext, adcToCOppm, getSmokeLevel,
  forecastTimeline, getHealthRecommendations, detectAnomaly,
  getSensorStats, generateCSV, trainAndPredictTF
} from './utils/calculations'
import { useGeminiInsights } from './hooks/useGeminiInsights'

// ─── Design Tokens ───────────────────────────────────────────────────────────
const T = {
  bg0: '#060c16', bg1: '#0a1522', bg2: '#0f1d30', bg3: '#152540',
  border: '#1b3253', borderMid: '#224070', borderBright: '#2d5490',
  text: '#cce0ff', textSub: '#5a80aa', textMuted: '#2d4d6e',
  cyan: '#06b6d4', purple: '#a78bfa', amber: '#f59e0b',
  red: '#ef4444', green: '#10b981', orange: '#f97316', pink: '#f472b6',
  teal: '#14b8a6', blue: '#38bdf8', yellow: '#facc15',
}

// ─── Sensor Configuration ────────────────────────────────────────────────────
const SENSORS = [
  { key: 'aqi',         label: 'AQI',          unit: '',       chartUnit: 'Index',   color: T.cyan,   fmt: v => Math.round(v)        },
  { key: 'nano_index',  label: 'Nano Index',    unit: '',       chartUnit: 'Index',   color: T.purple, fmt: v => Math.round(v)        },
  { key: 'pm25_ug',     label: 'PM2.5',         unit: 'µg/m³', chartUnit: 'µg/m³',  color: T.blue,   fmt: v => (+v).toFixed(1)      },
  { key: 'temperature', label: 'Temperature',   unit: '°C',    chartUnit: '°C',     color: T.orange, fmt: v => (+v).toFixed(1)      },
  { key: 'humidity',    label: 'Humidity',      unit: '% RH',  chartUnit: '%',      color: T.green,  fmt: v => (+v).toFixed(1)      },
  { key: 'co_ppm',      label: 'CO (MQ-7)',     unit: 'ppm',   chartUnit: 'ppm',    color: T.pink,   fmt: v => (+v).toFixed(1)      },
  { key: 'smoke_pct',   label: 'Smoke / Gas',   unit: '%',     chartUnit: '%',      color: T.amber,  fmt: v => Math.round(v) + '%'  },
]

// Sensors that get neural-network training (the 4 most analytically relevant)
const ML_SENSOR_KEYS = ['aqi', 'nano_index', 'co_ppm', 'pm25_ug']

const SEV = {
  good:     { bg: '#10b98114', border: '#10b98140', text: '#10b981' },
  info:     { bg: '#06b6d414', border: '#06b6d440', text: '#06b6d4' },
  warning:  { bg: '#f59e0b14', border: '#f59e0b40', text: '#f59e0b' },
  danger:   { bg: '#f9731614', border: '#f9731640', text: '#f97316' },
  critical: { bg: '#ef444414', border: '#ef444440', text: '#ef4444' },
}

// ─── Shared Tooltip Style ────────────────────────────────────────────────────
const TT = {
  contentStyle: {
    background: T.bg0, border: `1px solid ${T.border}`,
    color: T.text, borderRadius: 8, fontSize: '.78rem'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MetricCard
// ─────────────────────────────────────────────────────────────────────────────
function MetricCard({ sensor, value, stats }) {
  const trendColor = !stats ? T.textSub
    : stats.trend === 'rising'  ? T.red
    : stats.trend === 'falling' ? T.green
    : T.textSub
  const arrow = !stats ? '→'
    : stats.trend === 'rising'  ? '↑'
    : stats.trend === 'falling' ? '↓' : '→'

  return (
    <div style={{
      background: T.bg2, borderRadius: 10, padding: '1rem',
      border: `1px solid ${T.border}`, position: 'relative', overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${sensor.color}aa, transparent)`
      }} />
      <div style={{
        fontSize: '.67rem', color: T.textSub, letterSpacing: '.1em',
        textTransform: 'uppercase', marginBottom: '.45rem'
      }}>
        {sensor.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.3rem' }}>
        <span style={{
          fontSize: '2rem', fontWeight: 700, color: sensor.color,
          fontFamily: '"JetBrains Mono", monospace', lineHeight: 1
        }}>
          {value != null ? sensor.fmt(value) : '--'}
        </span>
        {sensor.unit && (
          <span style={{ fontSize: '.7rem', color: T.textSub }}>{sensor.unit}</span>
        )}
      </div>
      {stats && (
        <div style={{
          fontSize: '.66rem', color: T.textMuted, marginTop: '.5rem',
          display: 'flex', gap: '.8rem', alignItems: 'center'
        }}>
          <span>↓ {stats.min}</span>
          <span>∅ {stats.avg}</span>
          <span>↑ {stats.max}</span>
          <span style={{ marginLeft: 'auto', color: trendColor }}>
            {arrow} {Math.abs(stats.trendPct)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  SensorChart — used in "All Sensors" tab, optionally with forecast overlay
// ─────────────────────────────────────────────────────────────────────────────
function SensorChart({ data, sensor, forecastPoints = [], forecastLabel = 'forecast' }) {
  const combined = useMemo(() => {
    if (forecastPoints.length === 0)
      return data.map(d => ({ time: d.time, actual: d[sensor.key], forecast: null }))

    const hist = data.map(d => ({ time: d.time, actual: d[sensor.key], forecast: null }))
    if (hist.length === 0) return hist

    const bridge = { ...hist[hist.length - 1], forecast: hist[hist.length - 1].actual }
    const fpts   = forecastPoints.map(f => ({ time: `+${f.step}`, actual: null, forecast: f.value }))
    return [...hist, bridge, ...fpts]
  }, [data, sensor.key, forecastPoints])

  return (
    <div style={{
      background: T.bg2, borderRadius: 10, padding: '1rem',
      border: `1px solid ${T.border}`
    }}>
      <div style={{
        fontSize: '.78rem', color: T.textSub, marginBottom: '.5rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span>{sensor.label} <span style={{ color: T.textMuted }}>({sensor.chartUnit})</span></span>
        {forecastPoints.length > 0 && (
          <span style={{ fontSize: '.7rem', color: T.purple }}>— actual &nbsp;··· {forecastLabel}</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={155}>
        <ComposedChart data={combined} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
          <XAxis
            dataKey="time"
            tick={{ fill: T.textMuted, fontSize: 9 }}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis tick={{ fill: T.textMuted, fontSize: 9 }} width={36} tickLine={false} />
          <Tooltip {...TT} />
          <Line
            type="monotone" dataKey="actual"
            stroke={sensor.color} strokeWidth={2}
            dot={false} isAnimationActive={false} connectNulls={false}
          />
          {forecastPoints.length > 0 && (
            <Line
              type="monotone" dataKey="forecast"
              stroke={T.purple} strokeWidth={1.5} strokeDasharray="6 3"
              dot={{ r: 2, fill: T.purple }} isAnimationActive={false} connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  ForecastPanel — full-width timeline prediction for Nano Index (OLS)
// ─────────────────────────────────────────────────────────────────────────────
function ForecastPanel({ history }) {
  const forecasts = useMemo(() => forecastTimeline(history, 'nano_index', 6), [history])

  const chartData = useMemo(() => {
    if (history.length < 5 || forecasts.length === 0) return []
    const past = history.slice(-12).map(d => ({
      time: d.time,
      actual:   +Number(d.nano_index).toFixed(1),
      forecast: null, upper: null, lower: null
    }))
    const bridge = {
      time: past[past.length - 1]?.time,
      actual:   past[past.length - 1]?.actual,
      forecast: past[past.length - 1]?.actual,
      upper:    past[past.length - 1]?.actual,
      lower:    past[past.length - 1]?.actual,
    }
    const fpts = forecasts.map(f => ({
      time: `+${f.step}`, actual: null,
      forecast: f.value, upper: f.upper, lower: f.lower
    }))
    return [...past, bridge, ...fpts]
  }, [history, forecasts])

  if (chartData.length === 0 || forecasts.length === 0) return (
    <div style={{
      background: T.bg2, borderRadius: 12, padding: '2rem',
      border: `1px solid ${T.border}`, textAlign: 'center', color: T.textSub
    }}>
      📡 Need at least 5 readings to generate a forecast
    </div>
  )

  const lastNano      = history[history.length - 1]?.nano_index ?? 0
  const finalForecast = forecasts[forecasts.length - 1]
  const overallTrend  = finalForecast.value > lastNano + 2
    ? 'rising' : finalForecast.value < lastNano - 2 ? 'falling' : 'stable'
  const trendColor    = overallTrend === 'rising' ? T.red : overallTrend === 'falling' ? T.green : T.textSub

  return (
    <div style={{
      background: T.bg2, borderRadius: 12, padding: '1.2rem 1.4rem',
      border: `1px solid ${T.border}`, marginBottom: '1.2rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.9rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: T.text }}>
            🔮 Nano Index Forecast
          </div>
          <div style={{ fontSize: '.73rem', color: T.textSub, marginTop: '.2rem' }}>
            OLS linear regression · next 6 readings · see 🤖 AI tab for neural network forecast
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: '1.8rem', fontWeight: 700, color: T.purple,
            fontFamily: '"JetBrains Mono", monospace', lineHeight: 1
          }}>
            {finalForecast.value}
          </div>
          <div style={{ fontSize: '.72rem', color: trendColor, marginTop: '.15rem' }}>
            {overallTrend === 'rising'  ? '↑ Rising trend'
           : overallTrend === 'falling' ? '↓ Falling trend'
           :                              '→ Stable trend'}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="time" tick={{ fill: T.textMuted, fontSize: 9 }} interval="preserveStartEnd" tickLine={false} />
          <YAxis tick={{ fill: T.textMuted, fontSize: 10 }} width={36} tickLine={false} />
          <Tooltip {...TT} />
          <Area type="monotone" dataKey="upper" fill="rgba(167,139,250,0.10)" stroke="none" isAnimationActive={false} />
          <Area type="monotone" dataKey="lower" fill={T.bg2} stroke="none" isAnimationActive={false} />
          <Line type="monotone" dataKey="actual" stroke={T.cyan} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="forecast" stroke={T.purple} strokeWidth={2} strokeDasharray="6 3"
            dot={{ r: 3, fill: T.purple, strokeWidth: 0 }} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: '.5rem', marginTop: '.9rem', flexWrap: 'wrap' }}>
        {forecasts.map((f) => {
          const level = getNanoLevel(f.value)
          return (
            <div key={f.step} style={{
              flex: '1 1 70px', background: T.bg3, borderRadius: 8,
              padding: '.55rem .4rem', textAlign: 'center',
              border: `1px solid ${T.border}`,
              borderTop: `2px solid ${level.color}`
            }}>
              <div style={{ fontSize: '.62rem', color: T.textSub, marginBottom: '.15rem' }}>+{f.step}</div>
              <div style={{
                fontSize: '1.05rem', fontWeight: 700, color: level.color,
                fontFamily: '"JetBrains Mono", monospace'
              }}>{f.value}</div>
              <div style={{ fontSize: '.58rem', color: T.textMuted, marginTop: '.1rem' }}>{level.label}</div>
              <div style={{ fontSize: '.58rem', color: T.textMuted, marginTop: '.1rem' }}>
                {f.lower}–{f.upper}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '1.2rem', marginTop: '.8rem', fontSize: '.72rem', color: T.textSub }}>
        <span><span style={{ color: T.cyan }}>—</span> Actual readings</span>
        <span><span style={{ color: T.purple }}>···</span> Projected</span>
        <span><span style={{ color: 'rgba(167,139,250,0.4)' }}>▓</span> 90% confidence band</span>
        <span style={{ marginLeft: 'auto', color: T.textMuted }}>Values in 0–500 scale</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  HealthPanel — dynamic advisory cards
// ─────────────────────────────────────────────────────────────────────────────
function HealthPanel({ recommendations, aiPowered = false }) {
  if (!recommendations?.length) return null
  return (
    <div style={{
      background: T.bg2, borderRadius: 12, padding: '1.2rem',
      border: `1px solid ${T.border}`, marginBottom: '1.2rem'
    }}>
      <div style={{ fontWeight: 700, fontSize: '.9rem', color: T.text, marginBottom: '.8rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        🏥 Health Precautions
        {aiPowered && (
          <span style={{
            fontSize: '.62rem', color: T.purple, fontWeight: 500,
            background: T.purple + '22', border: `1px solid ${T.purple}44`,
            borderRadius: 4, padding: '1px 7px'
          }}>✨ Gemini AI</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
        {recommendations.map((rec, i) => {
          const s = SEV[rec.severity] ?? SEV.info
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '.7rem',
              background: s.bg, border: `1px solid ${s.border}`,
              borderRadius: 8, padding: '.55rem .85rem'
            }}>
              <span style={{ fontSize: '1.1rem', flexShrink: 0, lineHeight: 1.4 }}>{rec.icon}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '.82rem', color: T.text }}>{rec.text}</span>
                <span style={{
                  fontSize: '.62rem', color: s.text, marginLeft: '.6rem',
                  background: s.border, borderRadius: 4, padding: '1px 5px',
                  verticalAlign: 'middle'
                }}>{rec.category}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  AnomalyBanner
// ─────────────────────────────────────────────────────────────────────────────
function AnomalyBanner({ anomalies }) {
  const active = anomalies.filter(a => a.isAnomaly)
  if (active.length === 0) return null
  const isCritical = active.some(a => a.severity === 'critical')
  const col = isCritical ? T.red : T.amber

  return (
    <div style={{
      background: col + '12', border: `1px solid ${col}40`,
      borderRadius: 10, padding: '.75rem 1.1rem', marginBottom: '1rem',
      display: 'flex', alignItems: 'flex-start', gap: '.8rem'
    }}>
      <span style={{ fontSize: '1.3rem' }}>⚡</span>
      <div>
        <div style={{ fontWeight: 600, color: col, fontSize: '.88rem', marginBottom: '.25rem' }}>
          Anomaly Detected {isCritical ? '— Extreme Spike' : '— Unusual Reading'}
        </div>
        {active.map((a, i) => (
          <div key={i} style={{ fontSize: '.78rem', color: T.text, marginTop: '.1rem' }}>
            <span style={{ color: col, fontWeight: 600 }}>[{a.sensor}]</span> {a.message}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  StatsGrid — session min / max / avg for every sensor
// ─────────────────────────────────────────────────────────────────────────────
function StatsGrid({ transformedHistory }) {
  const count = transformedHistory.length
  return (
    <div style={{
      background: T.bg2, borderRadius: 12, padding: '1.2rem',
      border: `1px solid ${T.border}`, marginBottom: '1rem'
    }}>
      <div style={{ fontWeight: 700, fontSize: '.9rem', color: T.text, marginBottom: '.8rem' }}>
        📊 Session Analytics
        <span style={{ fontSize: '.72rem', color: T.textSub, fontWeight: 400, marginLeft: '.6rem' }}>
          {count} readings
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '.6rem'
      }}>
        {SENSORS.map(s => {
          const st = getSensorStats(transformedHistory, s.key)
          if (!st) return null
          const tCol  = st.trend === 'rising' ? T.red : st.trend === 'falling' ? T.green : T.textSub
          const arrow = st.trend === 'rising' ? '↑' : st.trend === 'falling' ? '↓' : '→'
          return (
            <div key={s.key} style={{
              background: T.bg3, borderRadius: 8, padding: '.75rem .9rem',
              border: `1px solid ${T.border}`,
              borderLeft: `3px solid ${s.color}`
            }}>
              <div style={{ fontSize: '.7rem', color: T.textSub, marginBottom: '.35rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                {s.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', fontSize: '.78rem', gap: '.2rem' }}>
                <div>
                  <div style={{ fontSize: '.6rem', color: T.textMuted }}>MIN</div>
                  <div style={{ color: T.text, fontFamily: '"JetBrains Mono", monospace' }}>{st.min}</div>
                </div>
                <div>
                  <div style={{ fontSize: '.6rem', color: T.textMuted }}>AVG</div>
                  <div style={{ color: s.color, fontFamily: '"JetBrains Mono", monospace' }}>{st.avg}</div>
                </div>
                <div>
                  <div style={{ fontSize: '.6rem', color: T.textMuted }}>MAX</div>
                  <div style={{ color: T.text, fontFamily: '"JetBrains Mono", monospace' }}>{st.max}</div>
                </div>
                <div>
                  <div style={{ fontSize: '.6rem', color: T.textMuted }}>TREND</div>
                  <div style={{ color: tCol, fontFamily: '"JetBrains Mono", monospace' }}>
                    {arrow}{Math.abs(st.trendPct)}%
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  MLStatusBadge — shows neural network training state
// ─────────────────────────────────────────────────────────────────────────────
function MLStatusBadge({ status, count }) {
  const cfg = {
    idle:     { color: T.textMuted, icon: '○', text: `Need 10+ readings (have ${count})`,        anim: false },
    training: { color: T.amber,     icon: '⚙', text: 'Training neural networks...',              anim: true  },
    ready:    { color: T.green,     icon: '●', text: `Model ready · ${count} training samples`, anim: false },
    error:    { color: T.red,       icon: '✕', text: 'TF.js not found — run: npm install @tensorflow/tfjs', anim: false },
  }[status] ?? { color: T.textMuted, icon: '○', text: '', anim: false }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '.45rem',
      background: cfg.color + '18', border: `1px solid ${cfg.color}38`,
      borderRadius: 6, padding: '.3rem .85rem', fontSize: '.76rem'
    }}>
      <span style={{ color: cfg.color, animation: cfg.anim ? 'pulse 1.2s infinite' : 'none' }}>
        {cfg.icon}
      </span>
      <span style={{ color: cfg.color }}>{cfg.text}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  MLForecastPanel — 2×2 grid of neural-network forecast mini-charts
// ─────────────────────────────────────────────────────────────────────────────
function MLForecastPanel({ predictions, status, transformedHistory, isMobile }) {
  const mlSensors = SENSORS.filter(s => ML_SENSOR_KEYS.includes(s.key))

  if (status === 'idle') return (
    <div style={{
      textAlign: 'center', padding: '2.5rem',
      color: T.textSub, fontSize: '.84rem',
      background: T.bg3, borderRadius: 10, border: `1px solid ${T.border}`
    }}>
      <div style={{ fontSize: '1.8rem', marginBottom: '.5rem' }}>📡</div>
      Collect 10 or more readings to begin neural network training
    </div>
  )

  if (status === 'training') return (
    <div style={{
      textAlign: 'center', padding: '3rem',
      background: T.bg3, borderRadius: 10, border: `1px solid ${T.border}`
    }}>
      <div style={{ fontSize: '2.2rem', marginBottom: '.7rem', animation: 'pulse 1.2s ease-in-out infinite' }}>🧠</div>
      <div style={{ fontSize: '.95rem', color: T.text, fontWeight: 600 }}>Training neural networks...</div>
      <div style={{ fontSize: '.76rem', color: T.textSub, marginTop: '.4rem' }}>
        Fitting 4 dense models on {transformedHistory.length} readings · typically 1–3 seconds
      </div>
    </div>
  )

  if (status === 'error') return (
    <div style={{
      textAlign: 'center', padding: '2rem',
      background: T.bg3, borderRadius: 10, border: `1px solid ${T.red}40`,
      color: T.red, fontSize: '.84rem'
    }}>
      <div style={{ marginBottom: '.4rem' }}>⚠ TensorFlow.js is not installed</div>
      <code style={{ background: T.bg0, padding: '3px 10px', borderRadius: 4, fontSize: '.8rem', color: T.textSub }}>
        npm install @tensorflow/tfjs
      </code>
    </div>
  )

  // status === 'ready'
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      gap: '1rem'
    }}>
      {mlSensors.map(s => (
        <SensorChart
          key={s.key}
          data={transformedHistory}
          sensor={s}
          forecastPoints={predictions[s.key] ?? []}
          forecastLabel="neural net"
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  GeminiPanel — API key input + AI health advisory display
// ─────────────────────────────────────────────────────────────────────────────
function GeminiPanel({ insights, loading, error, geminiInput, onKeyInput, onKeySave, hasKey }) {
  return (
    <div style={{
      background: T.bg2, borderRadius: 12, padding: '1.2rem 1.4rem',
      border: `1px solid ${T.border}`, marginBottom: '1.2rem'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '.9rem', color: T.text }}>
            ✨ Gemini AI Health Analysis
          </div>
          <div style={{ fontSize: '.72rem', color: T.textSub, marginTop: '.15rem' }}>
            Google Gemini 2.0 Flash · context-aware advisories · auto-updates on significant changes
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          {loading && (
            <span style={{ fontSize: '.75rem', color: T.cyan, animation: 'pulse 1.5s infinite' }}>
              ✨ Analyzing...
            </span>
          )}
          {hasKey && !loading && insights && (
            <span style={{ fontSize: '.72rem', color: T.green }}>● Live</span>
          )}
        </div>
      </div>

      {/* API Key input */}
      <div style={{
        background: T.bg3, borderRadius: 8, padding: '.85rem 1rem',
        border: `1px solid ${T.border}`,
        marginBottom: (hasKey && (insights || loading || error)) ? '1rem' : 0
      }}>
        <div style={{ fontSize: '.72rem', color: T.textSub, marginBottom: '.5rem' }}>
          🔑 Gemini API Key ·{' '}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            style={{ color: T.cyan, textDecoration: 'none' }}
          >
            Get a free key at Google AI Studio →
          </a>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <input
            type="password"
            value={geminiInput}
            onChange={e => onKeyInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onKeySave()}
            placeholder="AIzaSy..."
            style={{
              flex: 1, background: T.bg0, border: `1px solid ${T.borderMid}`,
              borderRadius: 7, padding: '.42rem .75rem', color: T.text,
              fontSize: '.8rem', fontFamily: '"JetBrains Mono", monospace',
              outline: 'none', minWidth: 0
            }}
          />
          <button
            onClick={onKeySave}
            disabled={!geminiInput.trim()}
            style={{
              background: T.cyan + '22', border: `1px solid ${T.cyan}55`,
              color: T.cyan, borderRadius: 7, padding: '.42rem .95rem',
              cursor: geminiInput.trim() ? 'pointer' : 'not-allowed',
              fontSize: '.8rem', fontFamily: 'inherit', whiteSpace: 'nowrap',
              opacity: geminiInput.trim() ? 1 : 0.5
            }}>
            {hasKey ? '↻ Update' : '⚡ Activate'}
          </button>
        </div>
        {error && (
          <div style={{
            fontSize: '.72rem', color: T.red, marginTop: '.5rem',
            background: T.red + '12', borderRadius: 5, padding: '.3rem .6rem'
          }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Recommendations */}
      {insights && insights.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
          {insights.map((rec, i) => {
            const s = SEV[rec.severity] ?? SEV.info
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '.7rem',
                background: s.bg, border: `1px solid ${s.border}`,
                borderRadius: 8, padding: '.55rem .85rem'
              }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0, lineHeight: 1.4 }}>{rec.icon}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '.82rem', color: T.text }}>{rec.text}</span>
                  <span style={{
                    fontSize: '.62rem', color: s.text, marginLeft: '.6rem',
                    background: s.border, borderRadius: 4, padding: '1px 5px',
                    verticalAlign: 'middle'
                  }}>{rec.category}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!hasKey && (
        <div style={{ textAlign: 'center', padding: '1.5rem 1rem', color: T.textMuted, fontSize: '.82rem' }}>
          Enter your Gemini API key above to enable AI-powered health analysis
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [current,      setCurrent]      = useState(null)
  const [history,      setHistory]      = useState([])
  const [lastSeen,     setLastSeen]     = useState(null)
  const [isMobile,     setIsMobile]     = useState(window.innerWidth < 768)
  const [tab,          setTab]          = useState('dashboard')

  // ── AI state ──────────────────────────────────────────────────────────────
  const [mlPredictions, setMlPredictions] = useState({})
  const [mlStatus,      setMlStatus]      = useState('idle')
  const [geminiKey,     setGeminiKey]     = useState(() => {
    try { return localStorage.getItem('aqm_gemini_key') || '' } catch { return '' }
  })
  const [geminiInput, setGeminiInput]     = useState(() => {
    try { return localStorage.getItem('aqm_gemini_key') || '' } catch { return '' }
  })

  const mlThrottleRef = useRef(0)

  // ── Font injection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const link   = document.createElement('link')
    link.rel     = 'stylesheet'
    link.href    = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@400;500;600;700&display=swap'
    document.head.appendChild(link)
    return () => document.head.removeChild(link)
  }, [])

  // ── Responsive ────────────────────────────────────────────────────────────
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  // ── Firebase: current reading ─────────────────────────────────────────────
  useEffect(() => {
    return onValue(ref(db, 'readings/current'), snap => {
      if (snap.exists()) {
        setCurrent(snap.val())
        setLastSeen(new Date().toLocaleTimeString('en-PH', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila'
        }))
      }
    })
  }, [])

  // ── Firebase: last 30 history readings ────────────────────────────────────
  useEffect(() => {
    const histRef = query(ref(db, 'readings/history'), limitToLast(30))
    return onValue(histRef, snap => {
      if (snap.exists()) {
        const entries = Object.values(snap.val()).map(r => ({
          ...r,
          time: new Date(r.timestamp * 1000).toLocaleTimeString('en-PH', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila'
          })
        }))
        setHistory(entries)
      }
    })
  }, [])

  // ── Transform history: add computed sensor keys ────────────────────────────
  const transformedHistory = useMemo(() => history.map(r => ({
    ...r,
    pm25_ug:   +((r.pm25 || 0) * 1000).toFixed(2),
    co_ppm:    +adcToCOppm(r.co),
    smoke_pct: +((r.smoke / 1023) * 100).toFixed(1),
  })), [history])

  // ── TF.js neural network training ─────────────────────────────────────────
  // Throttled: fires at most once every 8 seconds per new timestamp.
  // Uses a cancellation flag so in-flight training from a stale trigger is discarded.
  const lastTimestamp = transformedHistory[transformedHistory.length - 1]?.timestamp

  useEffect(() => {
    if (transformedHistory.length < 10) { setMlStatus('idle'); return }

    const now = Date.now()
    if (now - mlThrottleRef.current < 8_000) return   // throttle
    mlThrottleRef.current = now

    setMlStatus('training')
    let cancelled = false

    ;(async () => {
      try {
        const results = {}
        for (const key of ML_SENSOR_KEYS) {
          if (cancelled) return
          results[key] = await trainAndPredictTF(transformedHistory, key, 6)
        }
        if (!cancelled) {
          setMlPredictions(results)
          setMlStatus(Object.values(results).some(r => r.length > 0) ? 'ready' : 'error')
        }
      } catch {
        if (!cancelled) setMlStatus('error')
      }
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTimestamp])

  // ── Gemini insights hook ──────────────────────────────────────────────────
  const currentTransformed = useMemo(() => current ? {
    ...current,
    pm25_ug:   +((current.pm25 || 0) * 1000).toFixed(2),
    co_ppm:    +adcToCOppm(current.co),
    smoke_pct: +((current.smoke || 0) / 1023 * 100).toFixed(1),
  } : null, [current])

  // ── Derived values ─────────────────────────────────────────────────────────
  const aqi       = current ? Math.round(current.aqi)        : null
  const nano      = current ? Math.round(current.nano_index) : null
  const aqiLevel  = aqi  ? getAQILevel(aqi)  : null
  const nanoLevel = nano ? getNanoLevel(nano) : null
  const coPpm     = current ? adcToCOppm(current.co)      : null
  const smoke     = current ? getSmokeLevel(current.smoke) : null

  const recommendations = useMemo(() =>
    current ? getHealthRecommendations(aqi, nano, smoke?.pct, coPpm) : [],
    [aqi, nano, smoke, coPpm, current]
  )

  const anomalies = useMemo(() => {
    if (!current || history.length < 10) return []
    return [
      { sensor: 'AQI',        ...detectAnomaly(transformedHistory, 'aqi',        current.aqi) },
      { sensor: 'Nano Index', ...detectAnomaly(transformedHistory, 'nano_index',  current.nano_index) },
      { sensor: 'PM2.5',      ...detectAnomaly(transformedHistory, 'pm25_ug',     currentTransformed?.pm25_ug) },
      { sensor: 'CO',         ...detectAnomaly(transformedHistory, 'co_ppm',      currentTransformed?.co_ppm) },
    ]
  }, [current, history.length, transformedHistory, currentTransformed])

  const { insights: geminiInsights, loading: geminiLoading, error: geminiError } =
    useGeminiInsights(geminiKey, currentTransformed, anomalies)

  const nanoForecast = useMemo(() => forecastTimeline(history, 'nano_index', 6), [history])
  const prediction   = useMemo(() => predictNext(history, 'nano_index'), [history])

  // ── Gemini key save ────────────────────────────────────────────────────────
  const saveGeminiKey = useCallback(() => {
    const trimmed = geminiInput.trim()
    setGeminiKey(trimmed)
    try { localStorage.setItem('aqm_gemini_key', trimmed) } catch {}
  }, [geminiInput])

  // ── CSV download ───────────────────────────────────────────────────────────
  const downloadCSV = useCallback(() => {
    const csv  = generateCSV(history)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `air_quality_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [history])

  // ── Shared styles ─────────────────────────────────────────────────────────
  const tabBtn = (id) => ({
    padding: '.42rem .9rem', borderRadius: 7, cursor: 'pointer',
    fontSize: '.8rem', border: `1px solid ${tab === id ? T.cyan + '55' : 'transparent'}`,
    background: tab === id ? T.cyan + '18' : 'transparent',
    color: tab === id ? T.cyan : T.textSub,
    fontFamily: 'inherit', transition: 'all .18s', whiteSpace: 'nowrap'
  })

  const panelStyle = {
    background: T.bg2, borderRadius: 12, padding: '1.2rem',
    border: `1px solid ${T.border}`
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.bg0, color: T.text, fontFamily: '"Outfit", "Segoe UI", sans-serif' }}>

      {/* ══ Injected Global Styles ══════════════════════════════════════════ */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.85)} }
        button:hover { filter: brightness(1.12) }
        ::-webkit-scrollbar { width:6px; height:6px }
        ::-webkit-scrollbar-track { background: ${T.bg0} }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius:4px }
        input:focus { outline: 1px solid ${T.borderBright} !important; }
      `}</style>

      {/* ══ Header ══════════════════════════════════════════════════════════ */}
      <div style={{
        background: T.bg1, borderBottom: `1px solid ${T.border}`,
        padding: '.85rem 1.5rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: '.6rem'
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{ color: T.cyan, fontSize: '1.2rem', textShadow: `0 0 12px ${T.cyan}88` }}>◈</span>
            Smart Air Quality Monitor
          </div>
          <div style={{ fontSize: '.7rem', color: T.textSub, marginTop: '.1rem' }}>
            IoT · Arduino + ESP32 · Firebase Real-time
            {lastSeen && <span style={{ marginLeft: 10 }}>· Last update: {lastSeen}</span>}
            {mlStatus === 'ready' && (
              <span style={{ marginLeft: 10, color: T.purple }}>· 🧠 Neural net active</span>
            )}
            {geminiKey && geminiInsights && (
              <span style={{ marginLeft: 10, color: T.purple }}>· ✨ Gemini active</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
          <button
            onClick={downloadCSV}
            disabled={history.length === 0}
            style={{
              background: T.bg3, border: `1px solid ${T.borderMid}`,
              color: T.text, borderRadius: 8, padding: '.38rem .85rem',
              cursor: history.length ? 'pointer' : 'not-allowed',
              fontSize: '.76rem', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: '.35rem',
              opacity: history.length ? 1 : 0.4
            }}>
            ⬇ Export CSV
          </button>
          {lastSeen && (
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: T.green,
              boxShadow: `0 0 8px ${T.green}`,
              animation: 'pulse 2.2s ease-in-out infinite'
            }} title="Live" />
          )}
        </div>
      </div>

      {/* ══ Tab Bar ═════════════════════════════════════════════════════════ */}
      <div style={{
        background: T.bg1, borderBottom: `1px solid ${T.border}`,
        padding: '.4rem 1.5rem', display: 'flex', gap: '.3rem',
        overflowX: 'auto'
      }}>
        {[
          { id: 'dashboard', label: '📊 Dashboard'   },
          { id: 'forecast',  label: '🔮 Forecast'    },
          { id: 'ai',        label: '🤖 AI'           },
          { id: 'sensors',   label: '📡 All Sensors'  },
          { id: 'analytics', label: '🔬 Analytics'   },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabBtn(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ Content ═════════════════════════════════════════════════════════ */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.1rem 1.4rem' }}>

        {/* Anomaly Banner — visible on all tabs */}
        <AnomalyBanner anomalies={anomalies} />

        {/* Status Banner — visible on all tabs */}
        {aqiLevel && (
          <div style={{
            background: aqiLevel.color + '13', border: `1px solid ${aqiLevel.color}38`,
            borderRadius: 10, padding: '.8rem 1.2rem', marginBottom: '1.1rem',
            display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'
          }}>
            <span style={{ fontSize: '1.7rem' }}>
              {aqi <= 50 ? '😊' : aqi <= 100 ? '😐' : aqi <= 150 ? '😷' : '🚨'}
            </span>
            <div>
              <div style={{ fontWeight: 700, color: aqiLevel.color, fontSize: '.98rem' }}>
                Air Quality: {aqiLevel.label}
              </div>
              <div style={{ fontSize: '.78rem', color: T.textSub, marginTop: '.12rem' }}>
                AQI <strong style={{ color: T.cyan }}>{aqi}</strong>
                &nbsp;·&nbsp;
                Nano Index <strong style={{ color: T.purple }}>{nano}</strong>
                &nbsp;({nanoLevel?.label})
                &nbsp;·&nbsp;CO {coPpm} ppm
              </div>
              {smoke && smoke.pct >= 40 && (
                <div style={{ fontSize: '.74rem', color: smoke.color, marginTop: '.12rem' }}>
                  🔥 Smoke / gas detected — {smoke.label} ({smoke.pct}%)
                </div>
              )}
            </div>
            {prediction.value && (
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: '.68rem', color: T.textSub }}>Nano next est.</div>
                <div style={{
                  fontSize: '1.6rem', fontWeight: 700, color: T.purple,
                  fontFamily: '"JetBrains Mono", monospace', lineHeight: 1
                }}>
                  {prediction.value}
                </div>
                <div style={{
                  fontSize: '.7rem',
                  color: prediction.trend === 'rising'  ? T.red
                       : prediction.trend === 'falling' ? T.green : T.textSub
                }}>
                  {prediction.trend === 'rising'  ? '↑ rising'
                 : prediction.trend === 'falling' ? '↓ falling' : '→ stable'}
                  &nbsp;({prediction.pct}%)
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════ DASHBOARD TAB ════════════════════════════════ */}
        {tab === 'dashboard' && (
          <>
            {/* Metric Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '130px' : '155px'}, 1fr))`,
              gap: '.75rem', marginBottom: '1.1rem'
            }}>
              {SENSORS.map(s => {
                const val   = currentTransformed?.[s.key] ?? null
                const stats = getSensorStats(transformedHistory, s.key)
                return <MetricCard key={s.key} sensor={s} value={val} stats={stats} />
              })}
            </div>

            {/* Health recommendations — Gemini if key + insights available, else rule-based */}
            {geminiKey && geminiLoading && !geminiInsights && (
              <div style={{
                background: T.bg2, borderRadius: 10, padding: '.65rem 1rem',
                border: `1px solid ${T.borderMid}`, marginBottom: '.6rem',
                display: 'flex', alignItems: 'center', gap: '.6rem',
                fontSize: '.8rem', color: T.textSub
              }}>
                <span style={{ animation: 'pulse 1.5s infinite' }}>✨</span>
                Gemini AI is analyzing your air quality...
              </div>
            )}
            <HealthPanel
              recommendations={(geminiKey && geminiInsights) ? geminiInsights : recommendations}
              aiPowered={!!(geminiKey && geminiInsights)}
            />

            {/* AQI + Nano charts */}
            {history.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: '1rem'
              }}>
                <SensorChart data={transformedHistory} sensor={SENSORS[0]} />
                <SensorChart data={transformedHistory} sensor={SENSORS[1]} forecastPoints={nanoForecast} />
              </div>
            ) : (
              <div style={{ ...panelStyle, textAlign: 'center', padding: '4rem', color: T.textSub }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '.6rem' }}>📡</div>
                <div style={{ fontSize: '.92rem' }}>Waiting for sensor data from ESP32...</div>
                <div style={{ fontSize: '.78rem', marginTop: '.4rem', color: T.textMuted }}>
                  Ensure Arduino and ESP32 are powered and connected to WiFi
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════════════════ FORECAST TAB ═════════════════════════════════ */}
        {tab === 'forecast' && (
          <>
            <ForecastPanel history={history} />
            <div style={panelStyle}>
              <div style={{ fontWeight: 600, fontSize: '.88rem', color: T.text, marginBottom: '.6rem' }}>
                How forecasting works
              </div>
              <div style={{ fontSize: '.8rem', color: T.textSub, lineHeight: 1.75 }}>
                <div>• Uses <strong style={{ color: T.text }}>ordinary least squares (OLS) linear regression</strong> on the last 15 sensor readings.</div>
                <div>• Projects forward up to <strong style={{ color: T.text }}>6 readings</strong> — each step corresponds to one Arduino sensor cycle (~2 s).</div>
                <div>• Confidence interval widens with projection distance using root-mean-square error (RMSE) × √steps.</div>
                <div>• Best accuracy during steady-state conditions. Sudden events (cooking, traffic, HVAC) may cause rapid divergence.</div>
                <div>• The forecast updates automatically with every new Firebase reading.</div>
                <div style={{ marginTop: '.5rem', color: T.purple }}>
                  • For a <strong style={{ color: T.purple }}>neural network forecast</strong> across all 4 key sensors, visit the 🤖 AI tab.
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════ AI TAB ════════════════════════════════════════ */}
        {tab === 'ai' && (
          <>
            {/* ── Section 1: Neural Network Forecast ── */}
            <div style={{ ...panelStyle, marginBottom: '1.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: T.text }}>
                    🧠 Neural Network Forecast
                  </div>
                  <div style={{ fontSize: '.73rem', color: T.textSub, marginTop: '.2rem' }}>
                    2-layer dense network · TensorFlow.js · trained entirely in-browser · retrains every ~8 s
                  </div>
                </div>
                <MLStatusBadge status={mlStatus} count={transformedHistory.length} />
              </div>

              <MLForecastPanel
                predictions={mlPredictions}
                status={mlStatus}
                transformedHistory={transformedHistory}
                isMobile={isMobile}
              />

              {mlStatus === 'ready' && (
                <div style={{
                  display: 'flex', gap: '1.2rem', marginTop: '.9rem',
                  fontSize: '.72rem', color: T.textSub
                }}>
                  <span><span style={{ color: SENSORS[0].color }}>—</span> Actual readings</span>
                  <span><span style={{ color: T.purple }}>···</span> Neural net prediction</span>
                  <span style={{ marginLeft: 'auto', color: T.textMuted }}>
                    Each +step ≈ one sensor cycle (~2 s)
                  </span>
                </div>
              )}
            </div>

            {/* ── Section 2: Gemini AI Health Analysis ── */}
            <GeminiPanel
              insights={geminiInsights}
              loading={geminiLoading}
              error={geminiError}
              geminiInput={geminiInput}
              onKeyInput={setGeminiInput}
              onKeySave={saveGeminiKey}
              hasKey={!!geminiKey}
            />

            {/* ── Section 3: How it works ── */}
            <div style={panelStyle}>
              <div style={{ fontWeight: 600, fontSize: '.88rem', color: T.text, marginBottom: '.8rem' }}>
                How the AI works
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                <div style={{
                  background: T.bg3, borderRadius: 8, padding: '.85rem 1rem',
                  borderLeft: `3px solid ${T.purple}`
                }}>
                  <div style={{ fontWeight: 600, fontSize: '.82rem', color: T.purple, marginBottom: '.5rem' }}>
                    🧠 TensorFlow.js Neural Network
                  </div>
                  <div style={{ fontSize: '.78rem', color: T.textSub, lineHeight: 1.7 }}>
                    <div>• Architecture: Dense(16, ReLU) → Dropout(0.1) → Dense(8, ReLU) → Dense(1)</div>
                    <div>• Trains on a sliding window of 5 readings to predict the next value</div>
                    <div>• 80 training epochs with Adam optimizer (lr = 0.015)</div>
                    <div>• Autoregressively predicts 6 steps ahead by feeding predictions back as inputs</div>
                    <div>• Runs entirely in-browser — no data leaves your device</div>
                  </div>
                </div>
                <div style={{
                  background: T.bg3, borderRadius: 8, padding: '.85rem 1rem',
                  borderLeft: `3px solid ${T.cyan}`
                }}>
                  <div style={{ fontWeight: 600, fontSize: '.82rem', color: T.cyan, marginBottom: '.5rem' }}>
                    ✨ Google Gemini 2.0 Flash
                  </div>
                  <div style={{ fontSize: '.78rem', color: T.textSub, lineHeight: 1.7 }}>
                    <div>• Receives all 7 sensor readings + active anomaly messages</div>
                    <div>• Prompted with Philippine tropical climate context for relevant advice</div>
                    <div>• Rate-limited: calls only on significant sensor changes (AQI ±10, Nano ±15)</div>
                    <div>• Returns structured JSON — same format as the rule-based panel</div>
                    <div>• Free tier at Google AI Studio is sufficient for this use case</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════ ALL SENSORS TAB ══════════════════════════════ */}
        {tab === 'sensors' && (
          <>
            {history.length === 0 ? (
              <div style={{ ...panelStyle, textAlign: 'center', padding: '4rem', color: T.textSub }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '.6rem' }}>📡</div>
                <div>Waiting for sensor data from ESP32...</div>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: '1rem'
              }}>
                {SENSORS.map(s => (
                  <SensorChart
                    key={s.key}
                    data={transformedHistory}
                    sensor={s}
                    forecastPoints={
                      s.key === 'nano_index'
                        ? nanoForecast
                        : (mlStatus === 'ready' && ML_SENSOR_KEYS.includes(s.key))
                          ? (mlPredictions[s.key] ?? [])
                          : []
                    }
                    forecastLabel={s.key === 'nano_index' ? 'OLS' : 'neural net'}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ════════════════════ ANALYTICS TAB ════════════════════════════════ */}
        {tab === 'analytics' && (
          <>
            <StatsGrid transformedHistory={transformedHistory} />

            {current && (
              <div style={{ ...panelStyle, marginBottom: '1rem' }}>
                <div style={{ fontWeight: 600, fontSize: '.88rem', color: T.text, marginBottom: '.7rem' }}>
                  🚦 Current Status Summary
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '.6rem'
                }}>
                  {[
                    { label: 'AQI Status',    level: aqiLevel?.label,    color: aqiLevel?.color },
                    { label: 'Nano Risk',     level: nanoLevel?.label,   color: nanoLevel?.color },
                    { label: 'Smoke Level',   level: smoke?.label,       color: smoke?.color },
                    { label: 'Neural Net',    level: mlStatus === 'ready' ? 'Active' : mlStatus === 'training' ? 'Training...' : 'Idle', color: mlStatus === 'ready' ? T.green : mlStatus === 'training' ? T.amber : T.textMuted },
                    { label: 'Gemini AI',     level: geminiKey ? (geminiInsights ? 'Active' : geminiLoading ? 'Analyzing...' : 'Waiting') : 'No key set', color: (geminiKey && geminiInsights) ? T.green : geminiKey ? T.amber : T.textMuted },
                  ].map((item, i) => item.level ? (
                    <div key={i} style={{
                      background: (item.color ?? T.cyan) + '14',
                      border: `1px solid ${(item.color ?? T.cyan) + '40'}`,
                      borderRadius: 8, padding: '.65rem .9rem'
                    }}>
                      <div style={{ fontSize: '.65rem', color: T.textSub, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {item.label}
                      </div>
                      <div style={{ fontWeight: 700, color: item.color, marginTop: '.25rem' }}>
                        {item.level}
                      </div>
                    </div>
                  ) : null)}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap' }}>
              <button
                onClick={downloadCSV}
                disabled={history.length === 0}
                style={{
                  flex: '1 1 200px', background: T.bg2,
                  border: `1px solid ${T.borderMid}`, color: T.text,
                  borderRadius: 10, padding: '.9rem 1.5rem', cursor: 'pointer',
                  fontSize: '.85rem', fontFamily: 'inherit',
                  opacity: history.length ? 1 : 0.4
                }}>
                ⬇ Download CSV Report
                <span style={{ color: T.textSub, marginLeft: '.5rem' }}>({history.length} readings)</span>
              </button>
              <div style={{
                flex: '1 1 200px', background: T.bg2,
                border: `1px solid ${T.border}`, borderRadius: 10,
                padding: '.9rem 1.5rem', fontSize: '.82rem', color: T.textSub
              }}>
                Session started: {history[0]?.time ?? '--'}
                &nbsp;·&nbsp;
                Latest: {history[history.length - 1]?.time ?? '--'}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
