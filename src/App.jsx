// ─────────────────────────────────────────────────────────────────────────────
//  App.jsx  ·  Smart Air Quality Monitor — Unified Dashboard
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useMemo, useCallback } from 'react'
import { ref, onValue, query, limitToLast }           from 'firebase/database'
import { db }                                          from './firebase'
import * as tf                                         from '@tensorflow/tfjs'
import {
  ComposedChart, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Brush
} from 'recharts'
import {
  getAQILevel, getNanoLevel, adcToCOppm,
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

const TT = { contentStyle: { background: T.bg0, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, fontSize: '.78rem' } }

// ─────────────────────────────────────────────────────────────────────────────
//  Components
// ─────────────────────────────────────────────────────────────────────────────
function MetricCard({ sensor, value, stats }) {
  const trendColor = !stats ? T.textSub : stats.trend === 'rising' ? T.red : stats.trend === 'falling' ? T.green : T.textSub
  const arrow = !stats ? '→' : stats.trend === 'rising' ? '↑' : stats.trend === 'falling' ? '↓' : '→'
  return (
    <div style={{ background: T.bg2, borderRadius: 10, padding: '1rem', border: `1px solid ${T.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${sensor.color}aa, transparent)` }} />
      <div style={{ fontSize: '.67rem', color: T.textSub, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.45rem' }}>{sensor.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.3rem' }}>
        <span style={{ fontSize: '2rem', fontWeight: 700, color: sensor.color, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1 }}>{value != null ? sensor.fmt(value) : '--'}</span>
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
    const fpts   = forecastPoints.map(f => ({ time: f.time || f.label, actual: null, forecast: f.forecast || f.value }))
    return [...hist, bridge, ...fpts]
  }, [data, sensor.key, forecastPoints])

  return (
    <div style={{ background: T.bg2, borderRadius: 10, padding: '1rem', border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: '.78rem', color: T.textSub, marginBottom: '.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{sensor.label} <span style={{ color: T.textMuted }}>({sensor.chartUnit})</span></span>
        {forecastPoints.length > 0 && <span style={{ fontSize: '.7rem', color: T.purple }}>— actual &nbsp;··· forecast</span>}
      </div>
      
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart data={combined} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="time" tick={{ fill: T.textMuted, fontSize: 9 }} interval="preserveStartEnd" tickLine={false} />
          <YAxis tick={{ fill: T.textMuted, fontSize: 9 }} width={36} tickLine={false} />
          <Tooltip {...TT} />
          <Line type="monotone" dataKey="actual" stroke={sensor.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          {forecastPoints.length > 0 && <Line type="monotone" dataKey="forecast" stroke={T.purple} strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} connectNulls />}
          
          <Brush 
            dataKey="time" 
            height={20} 
            stroke={T.borderBright} 
            fill={T.bg1} 
            travellerWidth={14} 
            tickFormatter={() => ''} 
          />
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
  if (!anomalies || anomalies.length === 0) return null
  const isCritical = anomalies.some(a => a.severity === 'critical')
  const col = isCritical ? T.red : T.amber
  return (
    <div style={{ background: col + '12', border: `1px solid ${col}40`, borderRadius: 10, padding: '.75rem 1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '.8rem' }}>
      <span style={{ fontSize: '1.3rem' }}>⚡</span>
      <div>
        <div style={{ fontWeight: 600, color: col, fontSize: '.88rem', marginBottom: '.25rem' }}>Anomaly Detected</div>
        {anomalies.map((a, i) => (
          <div key={i} style={{ fontSize: '.78rem', color: T.text, marginTop: '.1rem' }}>
            <span style={{ color: col, fontWeight: 600 }}>[{a.sensor}]</span> {a.message}
          </div>
        ))}
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
  const [lastSeen, setLastSeen] = useState(null)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [tab, setTab] = useState('dashboard')

  // ML States
  const [tfForecast, setTfForecast] = useState(null)
  const [isTraining, setIsTraining] = useState(false)
  const [trainingProgress, setTrainingProgress] = useState(0)
  const [hasAutoTrained, setHasAutoTrained] = useState(false)

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@400;500;600;700&display=swap'
    document.head.appendChild(link)
    return () => document.head.removeChild(link)
  }, [])

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  useEffect(() => {
    const histRef = query(ref(db, 'readings/history'), limitToLast(500))
    return onValue(histRef, snap => {
      if (snap.exists()) {
        const entries = Object.values(snap.val()).map(r => ({
          ...r, time: new Date(r.timestamp * 1000).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
        }))
        setHistory(entries)
      }
    })
  }, [])

  useEffect(() => {
    return onValue(ref(db, 'readings/current'), snap => {
      if (snap.exists()) {
        setCurrent(snap.val())
        setLastSeen(new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila' }))
      }
    })
  }, [])

  // ─── TENSORFLOW.JS TRAINING LOGIC ──────────────────────────────────────────
  const trainAIModel = useCallback(async () => {
    if (history.length < 10) return
    setIsTraining(true)
    setTrainingProgress(0)

    const MAX_VAL = 500
    const rawData = history.map(d => (d.nano_index || 0) / MAX_VAL)
    const windowSize = 5
    const xsData = [], ysData = []
    
    for (let i = 0; i < rawData.length - windowSize; i++) {
      xsData.push(rawData.slice(i, i + windowSize))
      ysData.push(rawData[i + windowSize])
    }

    const xs = tf.tensor2d(xsData)
    const ys = tf.tensor2d(ysData, [ysData.length, 1])

    const model = tf.sequential()
    model.add(tf.layers.dense({ units: 16, inputShape: [windowSize], activation: 'relu' }))
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }))
    model.add(tf.layers.dense({ units: 1 }))
    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' })

    await model.fit(xs, ys, {
      epochs: 50, shuffle: true,
      callbacks: { onEpochEnd: (epoch) => setTrainingProgress(Math.round(((epoch + 1) / 50) * 100)) }
    })

    let currentWindow = rawData.slice(-windowSize)
    let predictions = []

    for (let i = 1; i <= 24; i++) {
      const inputTensor = tf.tensor2d([currentWindow])
      const prediction = model.predict(inputTensor)
      const predictedValue = prediction.dataSync()[0]
      
      let finalVal = predictedValue * MAX_VAL
      const dailyCycle = Math.sin(((i + 1) / 24) * Math.PI * 2) * 5
      finalVal = Math.max(0, Math.min(500, finalVal + dailyCycle))

      predictions.push({
        step: i, label: `+${i}h`, time: `+${i}h`,
        actual: null, forecast: Number(finalVal.toFixed(1)), value: Number(finalVal.toFixed(1))
      })

      currentWindow.shift()
      currentWindow.push(predictedValue)
      inputTensor.dispose()
      prediction.dispose()
    }

    xs.dispose(); ys.dispose(); model.dispose()
    setTfForecast(predictions)
    setIsTraining(false)
  }, [history])

  // ─── AUTO-TRAINING ENGINE ──────────────────────────────────────────────────
  useEffect(() => {
    // Initial auto-train when 10 readings arrive
    if (history.length >= 10 && !hasAutoTrained && !isTraining) {
      trainAIModel();
      setHasAutoTrained(true);
    }
    
    // Continuous background re-training every 30 minutes
    if (history.length >= 10) {
      const retrainInterval = setInterval(() => {
        if (!isTraining) trainAIModel();
      }, 30 * 60 * 1000); 
      return () => clearInterval(retrainInterval);
    }
  }, [history.length, hasAutoTrained, isTraining, trainAIModel]);

  // ─── Data Preparation ──────────────────────────────────────────────────────
  const transformedHistory = useMemo(() => history.map(r => ({
    ...r, pm25_ug: +((r.pm25 || 0) * 1000).toFixed(2), co_ppm: +adcToCOppm(r.co), smoke_pct: +((r.smoke / 1023) * 100).toFixed(1),
  })), [history])

  const aqi = current ? Math.round(current.aqi) : null
  const nano = current ? Math.round(current.nano_index) : null
  
  const currentTransformed = useMemo(() => current ? {
    ...current, pm25_ug: +((current.pm25 || 0) * 1000).toFixed(2), co_ppm: +adcToCOppm(current.co), smoke_pct: +((current.smoke || 0) / 1023 * 100).toFixed(1),
  } : null, [current])

  // EXCLUDES SMOKE AND CO PRECAUTIONS AS REQUESTED
  const recommendations = useMemo(() => {
    if (!current) return []
    const recs = getHealthRecommendations(aqi, nano, currentTransformed?.smoke_pct, currentTransformed?.co_ppm)
    return recs.filter(r => r.category !== 'Smoke' && r.category !== 'CO')
  }, [aqi, nano, current, currentTransformed])

  const anomalies = useMemo(() => {
    if (!current || history.length < 10) return []
    return [
      { sensor: 'AQI', ...detectAnomaly(transformedHistory, 'aqi', current.aqi) },
      { sensor: 'Nano Index', ...detectAnomaly(transformedHistory, 'nano_index', current.nano_index) },
      { sensor: 'PM2.5', ...detectAnomaly(transformedHistory, 'pm25_ug', currentTransformed?.pm25_ug) },
    ].filter(a => a.isAnomaly)
  }, [current, history.length, transformedHistory, currentTransformed])

  const chartData = useMemo(() => {
    let forecasts = tfForecast || forecast24Hours(history, 'nano_index')
    if (history.length < 5 || forecasts.length === 0) return []
    const past = history.slice(-15).map(d => ({
      time: d.time, actual: +Number(d.nano_index).toFixed(1), forecast: null
    }))
    const bridge = { time: past[past.length - 1]?.time, actual: past[past.length - 1]?.actual, forecast: past[past.length - 1]?.actual }
    return [...past, bridge, ...forecasts]
  }, [history, tfForecast])

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

  return (
    <div style={{ minHeight: '100vh', background: T.bg0, color: T.text, fontFamily: '"Outfit", "Segoe UI", sans-serif' }}>
      
      {/* Header Area */}
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.border}`, padding: '.85rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{ color: T.cyan, fontSize: '1.2rem', textShadow: `0 0 12px ${T.cyan}88` }}>◈</span>
            Smart Air Quality Monitor
          </div>
          <div style={{ fontSize: '.7rem', color: T.textSub, marginTop: '.1rem' }}>
            IoT · TensorFlow Auto-ML {lastSeen && <span style={{ marginLeft: 10, color: T.green }}>● Live: {lastSeen}</span>}
          </div>
        </div>
        <button onClick={downloadCSV} disabled={history.length === 0} style={{
            background: T.bg3, border: `1px solid ${T.borderMid}`, color: T.text, borderRadius: 8, padding: '.38rem .85rem',
            cursor: history.length ? 'pointer' : 'not-allowed', fontSize: '.76rem', fontFamily: 'inherit', opacity: history.length ? 1 : 0.4
          }}>
          ⬇ Export CSV
        </button>
      </div>

      {/* Navigation Tabs */}
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.border}`, padding: '.4rem 1.5rem', display: 'flex', gap: '.3rem', overflowX: 'auto' }}>
        {[{ id: 'dashboard', label: '📊 Dashboard' }, { id: 'forecast', label: '🧠 AI Forecast' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabBtn(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.1rem 1.4rem' }}>
        
        {/* Anomaly Alerts */}
        <AnomalyBanner anomalies={anomalies} />

        {/* ══════════ DASHBOARD TAB ══════════════════════════════════════════ */}
        {tab === 'dashboard' && (
          <>
            {/* Live Metrics with built-in analytics */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '130px' : '155px'}, 1fr))`, gap: '.75rem', marginBottom: '1.1rem' }}>
              {SENSORS.map(s => <MetricCard key={s.key} sensor={s} value={currentTransformed?.[s.key]} stats={getSensorStats(transformedHistory, s.key)} />)}
            </div>
            
            {/* Filtered Health Advice */}
            <HealthPanel recommendations={recommendations} />

            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: T.text, marginBottom: '1rem', marginTop: '2rem' }}>
              📈 Real-Time Sensor Trendlines
            </div>

            {/* FULL TRENDLINES FOR ALL 7 SENSORS */}
            {history.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
                {SENSORS.map(s => (
                  <SensorChart key={s.key} data={transformedHistory} sensor={s} forecastPoints={s.key === 'nano_index' ? (tfForecast || []) : []} />
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '4rem', color: T.textSub, background: T.bg2, borderRadius: 12, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '.6rem' }}>📡</div>
                <div>Waiting for sensor telemetry from Firebase...</div>
              </div>
            )}
          </>
        )}

        {/* ══════════ AI FORECAST TAB ════════════════════════════════════════ */}
        {tab === 'forecast' && (
          <div style={{ background: T.bg2, borderRadius: 12, padding: '1.2rem 1.4rem', border: `1px solid ${T.border}`, marginBottom: '1.2rem' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: T.text }}>🧠 TensorFlow.js On-Device ML</div>
                <div style={{ fontSize: '.8rem', color: T.textSub, marginTop: '.2rem' }}>
                  {tfForecast ? "Showing Neural Network Prediction (Auto-updating)" : isTraining ? "AI is currently learning your environment..." : "Waiting for enough sensor data to auto-train..."}
                </div>
              </div>

              <div style={{ minWidth: '200px' }}>
                <button onClick={trainAIModel} disabled={isTraining || history.length < 10} style={{
                    width: '100%', background: isTraining ? T.bg3 : T.purple, color: '#fff', border: 'none', padding: '.6rem 1rem',
                    borderRadius: '8px', cursor: isTraining ? 'wait' : 'pointer', fontWeight: 600, fontSize: '.85rem'
                  }}>
                  {isTraining ? `Training Neural Net... ${trainingProgress}%` : '🚀 Retrain AI Model Now'}
                </button>
                {isTraining && (
                  <div style={{ width: '100%', background: T.bg0, height: '6px', borderRadius: '4px', marginTop: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${trainingProgress}%`, background: T.cyan, height: '100%', transition: 'width 0.2s' }}></div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ width: '100%', height: '320px' }}> 
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                  <XAxis dataKey="time" tick={{ fill: T.textMuted, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: T.textMuted, fontSize: 10 }} />
                  <Tooltip {...TT} />
                  <Line type="monotone" dataKey="actual" stroke={T.cyan} strokeWidth={2} dot={false} connectNulls={false} name="Actual Nano Index" />
                  <Line type="monotone" dataKey="forecast" stroke={T.purple} strokeWidth={3} strokeDasharray="6 3" dot={false} connectNulls={false} name="AI Prediction" />
                  
                  <Brush 
                    dataKey="time" 
                    height={24} 
                    stroke={T.purple} 
                    fill={T.bg1} 
                    travellerWidth={16} 
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
