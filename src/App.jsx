// ─────────────────────────────────────────────────────────────────────────────
//  App.jsx  ·  Smart Air Quality Monitor — Cloud AI Enhanced
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useMemo, useCallback } from 'react'
import { ref, onValue, query, limitToLast }           from 'firebase/database'
import { db }                                          from './firebase'
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import {
  getAQILevel, getNanoLevel, predictNext, adcToCOppm, getSmokeLevel,
  forecast24Hours, getHealthRecommendations, detectAnomaly,
  getSensorStats, generateCSV
} from './utils/calculations'

// ─── Design Tokens ───────────────────────────────────────────────────────────
const T = {
  bg0: '#060c16', bg1: '#0a1522', bg2: '#0f1d30', bg3: '#152540',
  border: '#1b3253', borderMid: '#224070', borderBright: '#2d5490',
  text: '#cce0ff', textSub: '#5a80aa', textMuted: '#2d4d6e',
  cyan: '#06b6d4', purple: '#a78bfa', amber: '#f59e0b',
  red: '#ef4444', green: '#10b981', orange: '#f97316', pink: '#f472b6',
  teal: '#14b8a6', blue: '#38bdf8', yellow: '#facc15',
}

const SENSORS = [
  { key: 'aqi',         label: 'AQI',          unit: '',       chartUnit: 'Index',   color: T.cyan,   fmt: v => Math.round(v)        },
  { key: 'nano_index',  label: 'Nano Index',    unit: '',       chartUnit: 'Index',   color: T.purple, fmt: v => Math.round(v)        },
  { key: 'pm25_ug',     label: 'PM2.5',         unit: 'µg/m³', chartUnit: 'µg/m³',  color: T.blue,   fmt: v => (+v).toFixed(1)      },
  { key: 'temperature', label: 'Temperature',   unit: '°C',    chartUnit: '°C',     color: T.orange, fmt: v => (+v).toFixed(1)      },
  { key: 'humidity',    label: 'Humidity',      unit: '% RH',  chartUnit: '%',      color: T.green,  fmt: v => (+v).toFixed(1)      },
  { key: 'co_ppm',      label: 'CO (MQ-7)',     unit: 'ppm',   chartUnit: 'ppm',    color: T.pink,   fmt: v => (+v).toFixed(1)      },
  { key: 'smoke_pct',   label: 'Smoke / Gas',   unit: '%',     chartUnit: '%',      color: T.amber,  fmt: v => Math.round(v) + '%'  },
]

const SEV = {
  good:     { bg: '#10b98114', border: '#10b98140', text: '#10b981' },
  info:     { bg: '#06b6d414', border: '#06b6d440', text: '#06b6d4' },
  warning:  { bg: '#f59e0b14', border: '#f59e0b40', text: '#f59e0b' },
  danger:   { bg: '#f9731614', border: '#f9731640', text: '#f97316' },
  critical: { bg: '#ef444414', border: '#ef444440', text: '#ef4444' },
}

const TT = {
  contentStyle: {
    background: T.bg0, border: `1px solid ${T.border}`,
    color: T.text, borderRadius: 8, fontSize: '.78rem'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Components
// ─────────────────────────────────────────────────────────────────────────────
function MetricCard({ sensor, value, stats }) {
  const trendColor = !stats ? T.textSub : stats.trend === 'rising' ? T.red : stats.trend === 'falling' ? T.green : T.textSub
  const arrow = !stats ? '→' : stats.trend === 'rising' ? '↑' : stats.trend === 'falling' ? '↓' : '→'

  return (
    <div style={{
      background: T.bg2, borderRadius: 10, padding: '1rem',
      border: `1px solid ${T.border}`, position: 'relative', overflow: 'hidden'
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${sensor.color}aa, transparent)` }} />
      <div style={{ fontSize: '.67rem', color: T.textSub, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.45rem' }}>{sensor.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.3rem' }}>
        <span style={{ fontSize: '2rem', fontWeight: 700, color: sensor.color, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1 }}>
          {value != null ? sensor.fmt(value) : '--'}
        </span>
        {sensor.unit && <span style={{ fontSize: '.7rem', color: T.textSub }}>{sensor.unit}</span>}
      </div>
      {stats && (
        <div style={{ fontSize: '.66rem', color: T.textMuted, marginTop: '.5rem', display: 'flex', gap: '.8rem', alignItems: 'center' }}>
          <span>↓ {stats.min}</span><span>∅ {stats.avg}</span><span>↑ {stats.max}</span>
          <span style={{ marginLeft: 'auto', color: trendColor }}>{arrow} {Math.abs(stats.trendPct)}%</span>
        </div>
      )}
    </div>
  )
}

function SensorChart({ data, sensor, forecastPoints = [] }) {
  const combined = useMemo(() => {
    if (forecastPoints.length === 0) return data.map(d => ({ time: d.time, actual: d[sensor.key], forecast: null }))
    const hist = data.map(d => ({ time: d.time, actual: d[sensor.key], forecast: null }))
    if (hist.length === 0) return hist
    const bridge = { ...hist[hist.length - 1], forecast: hist[hist.length - 1].actual }
    const fpts   = forecastPoints.map(f => ({ time: f.label, actual: null, forecast: f.value }))
    return [...hist, bridge, ...fpts]
  }, [data, sensor.key, forecastPoints])

  return (
    <div style={{ background: T.bg2, borderRadius: 10, padding: '1rem', border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: '.78rem', color: T.textSub, marginBottom: '.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{sensor.label} <span style={{ color: T.textMuted }}>({sensor.chartUnit})</span></span>
        {forecastPoints.length > 0 && <span style={{ fontSize: '.7rem', color: T.purple }}>— actual &nbsp;··· forecast</span>}
      </div>
      <ResponsiveContainer width="100%" height={155}>
        <ComposedChart data={combined} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="time" tick={{ fill: T.textMuted, fontSize: 9 }} interval="preserveStartEnd" tickLine={false} />
          <YAxis tick={{ fill: T.textMuted, fontSize: 9 }} width={36} tickLine={false} />
          <Tooltip {...TT} />
          <Line type="monotone" dataKey="actual" stroke={sensor.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          {forecastPoints.length > 0 && <Line type="monotone" dataKey="forecast" stroke={T.purple} strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function ForecastPanel({ history, cloudForecastData }) {
  // If Cloud Data exists, use it. Otherwise, use local 24h mathematical forecast.
  const forecasts = useMemo(() => {
    if (cloudForecastData && cloudForecastData.length > 0) return cloudForecastData;
    return forecast24Hours(history, 'nano_index')
  }, [history, cloudForecastData])

  const chartData = useMemo(() => {
    if (history.length < 5 || forecasts.length === 0) return []
    const past = history.slice(-12).map(d => ({
      time: d.time, actual: +Number(d.nano_index).toFixed(1), forecast: null, upper: null, lower: null
    }))
    const bridge = {
      time: past[past.length - 1]?.time, actual: past[past.length - 1]?.actual,
      forecast: past[past.length - 1]?.actual, upper: past[past.length - 1]?.actual, lower: past[past.length - 1]?.actual,
    }
    const fpts = forecasts.map(f => ({
      time: f.label, actual: null, forecast: f.value, upper: f.upper, lower: f.lower
    }))
    return [...past, bridge, ...fpts]
  }, [history, forecasts])

  if (chartData.length === 0 || forecasts.length === 0) return (
    <div style={{ background: T.bg2, borderRadius: 12, padding: '2rem', border: `1px solid ${T.border}`, textAlign: 'center', color: T.textSub }}>
      📡 Gathering data for 24-hour prediction...
    </div>
  )

  const lastNano = history[history.length - 1]?.nano_index ?? 0
  const finalForecast = forecasts[forecasts.length - 1]
  const overallTrend = finalForecast.value > lastNano + 5 ? 'rising' : finalForecast.value < lastNano - 5 ? 'falling' : 'stable'
  const trendColor = overallTrend === 'rising' ? T.red : overallTrend === 'falling' ? T.green : T.textSub
  const sourceLabel = cloudForecastData ? '☁️ Cloud AI Model' : '💻 Local Regression Fallback'

  return (
    <div style={{ background: T.bg2, borderRadius: 12, padding: '1.2rem 1.4rem', border: `1px solid ${T.border}`, marginBottom: '1.2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.9rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: T.text }}>🔮 24-Hour Nano Index Forecast</div>
          <div style={{ fontSize: '.73rem', color: T.textSub, marginTop: '.2rem' }}>Source: {sourceLabel}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: T.purple, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1 }}>
            {finalForecast.value}
          </div>
          <div style={{ fontSize: '.72rem', color: trendColor, marginTop: '.15rem' }}>
            {overallTrend === 'rising' ? '↑ Rising trend' : overallTrend === 'falling' ? '↓ Falling trend' : '→ Stable trend'}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="time" tick={{ fill: T.textMuted, fontSize: 9 }} interval={Math.floor(chartData.length / 8)} tickLine={false} />
          <YAxis tick={{ fill: T.textMuted, fontSize: 10 }} width={36} tickLine={false} />
          <Tooltip {...TT} />
          <Area type="monotone" dataKey="upper" fill="rgba(167,139,250,0.10)" stroke="none" isAnimationActive={false} />
          <Area type="monotone" dataKey="lower" fill={T.bg2} stroke="none" isAnimationActive={false} />
          <Line type="monotone" dataKey="actual" stroke={T.cyan} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="forecast" stroke={T.purple} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function HealthPanel({ recommendations }) {
  if (!recommendations?.length) return null
  return (
    <div style={{ background: T.bg2, borderRadius: 12, padding: '1.2rem', border: `1px solid ${T.border}`, marginBottom: '1.2rem' }}>
      <div style={{ fontWeight: 700, fontSize: '.9rem', color: T.text, marginBottom: '.8rem' }}>🏥 Health Precautions</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
        {recommendations.map((rec, i) => {
          const s = SEV[rec.severity] ?? SEV.info
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.7rem', background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '.55rem .85rem' }}>
              <span style={{ fontSize: '1.1rem', flexShrink: 0, lineHeight: 1.4 }}>{rec.icon}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '.82rem', color: T.text }}>{rec.text}</span>
                <span style={{ fontSize: '.62rem', color: s.text, marginLeft: '.6rem', background: s.border, borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }}>{rec.category}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AnomalyBanner({ anomalies }) {
  const active = anomalies.filter(a => a.isAnomaly)
  if (active.length === 0) return null
  const isCritical = active.some(a => a.severity === 'critical')
  const col = isCritical ? T.red : T.amber
  return (
    <div style={{ background: col + '12', border: `1px solid ${col}40`, borderRadius: 10, padding: '.75rem 1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '.8rem' }}>
      <span style={{ fontSize: '1.3rem' }}>⚡</span>
      <div>
        <div style={{ fontWeight: 600, color: col, fontSize: '.88rem', marginBottom: '.25rem' }}>Anomaly Detected {isCritical ? '— Extreme Spike' : '— Unusual Reading'}</div>
        {active.map((a, i) => (
          <div key={i} style={{ fontSize: '.78rem', color: T.text, marginTop: '.1rem' }}>
            <span style={{ color: col, fontWeight: 600 }}>[{a.sensor}]</span> {a.message}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatsGrid({ transformedHistory }) {
  const count = transformedHistory.length
  return (
    <div style={{ background: T.bg2, borderRadius: 12, padding: '1.2rem', border: `1px solid ${T.border}`, marginBottom: '1rem' }}>
      <div style={{ fontWeight: 700, fontSize: '.9rem', color: T.text, marginBottom: '.8rem' }}>
        📊 Session Analytics <span style={{ fontSize: '.72rem', color: T.textSub, fontWeight: 400, marginLeft: '.6rem' }}>{count} readings</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.6rem' }}>
        {SENSORS.map(s => {
          const st = getSensorStats(transformedHistory, s.key)
          if (!st) return null
          const tCol = st.trend === 'rising' ? T.red : st.trend === 'falling' ? T.green : T.textSub
          const arrow = st.trend === 'rising' ? '↑' : st.trend === 'falling' ? '↓' : '→'
          return (
            <div key={s.key} style={{ background: T.bg3, borderRadius: 8, padding: '.75rem .9rem', border: `1px solid ${T.border}`, borderLeft: `3px solid ${s.color}` }}>
              <div style={{ fontSize: '.7rem', color: T.textSub, marginBottom: '.35rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>{s.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', fontSize: '.78rem', gap: '.2rem' }}>
                <div><div style={{ fontSize: '.6rem', color: T.textMuted }}>MIN</div><div style={{ color: T.text, fontFamily: '"JetBrains Mono", monospace' }}>{st.min}</div></div>
                <div><div style={{ fontSize: '.6rem', color: T.textMuted }}>AVG</div><div style={{ color: s.color, fontFamily: '"JetBrains Mono", monospace' }}>{st.avg}</div></div>
                <div><div style={{ fontSize: '.6rem', color: T.textMuted }}>MAX</div><div style={{ color: T.text, fontFamily: '"JetBrains Mono", monospace' }}>{st.max}</div></div>
                <div><div style={{ fontSize: '.6rem', color: T.textMuted }}>TREND</div><div style={{ color: tCol, fontFamily: '"JetBrains Mono", monospace' }}>{arrow}{Math.abs(st.trendPct)}%</div></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [current, setCurrent] = useState(null)
  const [history, setHistory] = useState([])
  const [cloudML, setCloudML] = useState(null) // NEW: State for cloud predictions
  const [lastSeen, setLastSeen] = useState(null)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [tab, setTab] = useState('dashboard')

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@400;500;600;700&display=swap'
    document.head.appendChild(link)
    return () => document.head.removeChild(link)
  }, [])

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  useEffect(() => {
    return onValue(ref(db, 'readings/current'), snap => {
      if (snap.exists()) {
        setCurrent(snap.val())
        setLastSeen(new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila' }))
      }
    })
  }, [])

  useEffect(() => {
    const histRef = query(ref(db, 'readings/history'), limitToLast(30))
    return onValue(histRef, snap => {
      if (snap.exists()) {
        const entries = Object.values(snap.val()).map(r => ({
          ...r, time: new Date(r.timestamp * 1000).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
        }))
        setHistory(entries)
      }
    })
  }, [])

  // NEW: Firebase Listener for Cloud ML Endpoint
  useEffect(() => {
    return onValue(ref(db, 'readings/cloud_forecast_24h'), snap => {
      if (snap.exists()) {
        setCloudML(snap.val()) // Payload generated by your Cloud Backend
      } else {
        setCloudML(null)
      }
    })
  }, [])

  const transformedHistory = useMemo(() => history.map(r => ({
    ...r, pm25_ug: +((r.pm25 || 0) * 1000).toFixed(2), co_ppm: +adcToCOppm(r.co), smoke_pct: +((r.smoke / 1023) * 100).toFixed(1),
  })), [history])

  const aqi = current ? Math.round(current.aqi) : null
  const nano = current ? Math.round(current.nano_index) : null
  const aqiLevel = aqi ? getAQILevel(aqi) : null
  const nanoLevel = nano ? getNanoLevel(nano) : null
  const coPpm = current ? adcToCOppm(current.co) : null
  const smoke = current ? getSmokeLevel(current.smoke) : null

  const currentTransformed = useMemo(() => current ? {
    ...current, pm25_ug: +((current.pm25 || 0) * 1000).toFixed(2), co_ppm: +adcToCOppm(current.co), smoke_pct: +((current.smoke || 0) / 1023 * 100).toFixed(1),
  } : null, [current])

  const recommendations = useMemo(() => current ? getHealthRecommendations(aqi, nano, smoke?.pct, coPpm) : [], [aqi, nano, smoke, coPpm, current])

  const anomalies = useMemo(() => {
    if (!current || history.length < 10) return []
    return [
      { sensor: 'AQI', ...detectAnomaly(transformedHistory, 'aqi', current.aqi) },
      { sensor: 'Nano Index', ...detectAnomaly(transformedHistory, 'nano_index', current.nano_index) },
      { sensor: 'PM2.5', ...detectAnomaly(transformedHistory, 'pm25_ug', currentTransformed?.pm25_ug) },
      { sensor: 'CO', ...detectAnomaly(transformedHistory, 'co_ppm', currentTransformed?.co_ppm) },
    ]
  }, [current, history.length, transformedHistory, currentTransformed])

  // Either use Cloud ML or Fallback to Local Forecast
  const nanoForecast = useMemo(() => cloudML || forecast24Hours(history, 'nano_index'), [history, cloudML])
  const prediction = useMemo(() => predictNext(history, 'nano_index'), [history])

  const downloadCSV = useCallback(() => {
    const csv = generateCSV(history); const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `air_quality_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }, [history])

  const tabBtn = (id) => ({
    padding: '.42rem .9rem', borderRadius: 7, cursor: 'pointer', fontSize: '.8rem',
    border: `1px solid ${tab === id ? T.cyan + '55' : 'transparent'}`, background: tab === id ? T.cyan + '18' : 'transparent',
    color: tab === id ? T.cyan : T.textSub, fontFamily: 'inherit', transition: 'all .18s', whiteSpace: 'nowrap'
  })
  const panelStyle = { background: T.bg2, borderRadius: 12, padding: '1.2rem', border: `1px solid ${T.border}` }

  return (
    <div style={{ minHeight: '100vh', background: T.bg0, color: T.text, fontFamily: '"Outfit", "Segoe UI", sans-serif' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.85)} }
        button:hover { filter: brightness(1.12) }
        ::-webkit-scrollbar { width:6px; height:6px }
        ::-webkit-scrollbar-track { background: ${T.bg0} }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius:4px }
      `}</style>

      {/* Header */}
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.border}`, padding: '.85rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{ color: T.cyan, fontSize: '1.2rem', textShadow: `0 0 12px ${T.cyan}88` }}>◈</span>
            Smart Air Quality Monitor
          </div>
          <div style={{ fontSize: '.7rem', color: T.textSub, marginTop: '.1rem' }}>
            IoT · Firebase Real-time {cloudML && <span style={{ color: T.purple }}>· Cloud AI Connected</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
          <button onClick={downloadCSV} disabled={history.length === 0} style={{ background: T.bg3, border: `1px solid ${T.borderMid}`, color: T.text, borderRadius: 8, padding: '.38rem .85rem', cursor: history.length ? 'pointer' : 'not-allowed', fontSize: '.76rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '.35rem', opacity: history.length ? 1 : 0.4 }}>⬇ Export CSV</button>
          {lastSeen && <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.green, boxShadow: `0 0 8px ${T.green}`, animation: 'pulse 2.2s ease-in-out infinite' }} title="Live" />}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.border}`, padding: '.4rem 1.5rem', display: 'flex', gap: '.3rem', overflowX: 'auto' }}>
        {[{ id: 'dashboard', label: '📊 Dashboard' }, { id: 'forecast', label: '🔮 24h Forecast' }, { id: 'sensors', label: '📡 All Sensors' }, { id: 'analytics', label: '🔬 Analytics' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabBtn(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.1rem 1.4rem' }}>
        <AnomalyBanner anomalies={anomalies} />
        {aqiLevel && (
          <div style={{ background: aqiLevel.color + '13', border: `1px solid ${aqiLevel.color}38`, borderRadius: 10, padding: '.8rem 1.2rem', marginBottom: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.7rem' }}>{aqi <= 50 ? '😊' : aqi <= 100 ? '😐' : aqi <= 150 ? '😷' : '🚨'}</span>
            <div>
              <div style={{ fontWeight: 700, color: aqiLevel.color, fontSize: '.98rem' }}>Air Quality: {aqiLevel.label}</div>
              <div style={{ fontSize: '.78rem', color: T.textSub, marginTop: '.12rem' }}>AQI <strong style={{ color: T.cyan }}>{aqi}</strong> &nbsp;·&nbsp; Nano Index <strong style={{ color: T.purple }}>{nano}</strong> &nbsp;({nanoLevel?.label})</div>
            </div>
            {prediction.value && (
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: '.68rem', color: T.textSub }}>Nano next est.</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: T.purple, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1 }}>{prediction.value}</div>
              </div>
            )}
          </div>
        )}

        {tab === 'dashboard' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '130px' : '155px'}, 1fr))`, gap: '.75rem', marginBottom: '1.1rem' }}>
              {SENSORS.map(s => <MetricCard key={s.key} sensor={s} value={currentTransformed?.[s.key]} stats={getSensorStats(transformedHistory, s.key)} />)}
            </div>
            <HealthPanel recommendations={recommendations} />
            {history.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                <SensorChart data={transformedHistory} sensor={SENSORS[0]} />
                <SensorChart data={transformedHistory} sensor={SENSORS[1]} />
              </div>
            ) : <div style={{ ...panelStyle, textAlign: 'center', padding: '4rem', color: T.textSub }}>📡 Waiting for sensor data...</div>}
          </>
        )}

        {tab === 'forecast' && (
          <>
            <ForecastPanel history={history} cloudForecastData={cloudML} />
            <div style={panelStyle}>
              <div style={{ fontWeight: 600, fontSize: '.88rem', color: T.text, marginBottom: '.6rem' }}>How the Cloud ML Approach Works</div>
              <div style={{ fontSize: '.8rem', color: T.textSub, lineHeight: 1.75 }}>
                <div>• The app listens to the Firebase database path <strong style={{ color: T.purple }}>`readings/cloud_forecast_24h`</strong>.</div>
                <div>• If a Python or Node backend generates ML predictions to that path, the dashboard instantly visualizes them.</div>
                <div>• If the cloud endpoint is empty, it elegantly falls back to a <strong style={{ color: T.cyan }}>local mathematical regression</strong> inside `calculations.js`.</div>
              </div>
            </div>
          </>
        )}

        {tab === 'sensors' && (
          <>
            {history.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem' }}>
                {SENSORS.map(s => <SensorChart key={s.key} data={transformedHistory} sensor={s} forecastPoints={s.key === 'nano_index' ? nanoForecast : []} />)}
              </div>
            ) : <div style={{ ...panelStyle, textAlign: 'center', padding: '4rem', color: T.textSub }}>📡 Waiting for sensor data...</div>}
          </>
        )}

        {tab === 'analytics' && (
          <>
            <StatsGrid transformedHistory={transformedHistory} />
            {current && (
              <div style={{ ...panelStyle, marginBottom: '1rem' }}>
                <div style={{ fontWeight: 600, fontSize: '.88rem', color: T.text, marginBottom: '.7rem' }}>🚦 Current Status Summary</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.6rem' }}>
                  {[{ label: 'AQI Status', level: aqiLevel?.label, color: aqiLevel?.color }, { label: 'Nano Risk', level: nanoLevel?.label, color: nanoLevel?.color }, { label: 'Smoke Level', level: smoke?.label, color: smoke?.color }].map((item, i) => item.level ? (
                    <div key={i} style={{ background: (item.color ?? T.cyan) + '14', border: `1px solid ${(item.color ?? T.cyan) + '40'}`, borderRadius: 8, padding: '.65rem .9rem' }}>
                      <div style={{ fontSize: '.65rem', color: T.textSub, textTransform: 'uppercase', letterSpacing: '.08em' }}>{item.label}</div>
                      <div style={{ fontWeight: 700, color: item.color, marginTop: '.25rem' }}>{item.level}</div>
                    </div>
                  ) : null)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
