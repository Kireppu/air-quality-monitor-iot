// ─────────────────────────────────────────────────────────────────────────────
//  App.jsx  ·  Smart Air Quality Monitor — TensorFlow.js On-Device ML
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useMemo, useCallback } from 'react'
import { ref, onValue, query, limitToLast }           from 'firebase/database'
import { db }                                          from './firebase'
import * as tf                                         from '@tensorflow/tfjs'
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

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@400;500;600;700&display=swap'
    document.head.appendChild(link)
    return () => document.head.removeChild(link)
  }, [])

  // Increased limit to 100 to give the Neural Network more data to learn from
  useEffect(() => {
    const histRef = query(ref(db, 'readings/history'), limitToLast(100))
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
  const trainAIModel = async () => {
    if (history.length < 10) return alert("Not enough data to train the model. Wait for more sensor readings.")
    
    setIsTraining(true)
    setTrainingProgress(0)

    // 1. Prepare Data (Normalize 0 to 1 based on a max scale of 500)
    const MAX_VAL = 500
    const rawData = history.map(d => (d.nano_index || 0) / MAX_VAL)
    
    // 2. Create Sliding Windows (Look at 5 past readings to predict the 6th)
    const windowSize = 5
    const xsData = [], ysData = []
    
    for (let i = 0; i < rawData.length - windowSize; i++) {
      xsData.push(rawData.slice(i, i + windowSize))
      ysData.push(rawData[i + windowSize])
    }

    // Convert to Tensors
    const xs = tf.tensor2d(xsData)
    const ys = tf.tensor2d(ysData, [ysData.length, 1])

    // 3. Build the Neural Network Model
    const model = tf.sequential()
    model.add(tf.layers.dense({ units: 16, inputShape: [windowSize], activation: 'relu' }))
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }))
    model.add(tf.layers.dense({ units: 1 })) // Output Layer

    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' })

    // 4. Train the Model
    await model.fit(xs, ys, {
      epochs: 50,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          setTrainingProgress(Math.round(((epoch + 1) / 50) * 100))
        }
      }
    })

    // 5. Predict the next 24 Hours
    let currentWindow = rawData.slice(-windowSize)
    let predictions = []

    for (let i = 1; i <= 24; i++) {
      const inputTensor = tf.tensor2d([currentWindow])
      const prediction = model.predict(inputTensor)
      const predictedValue = prediction.dataSync()[0]
      
      // De-normalize back to Nano Index scale
      let finalVal = predictedValue * MAX_VAL
      
      // Add a slight sinusoidal wave to mimic daily atmospheric variance
      const dailyCycle = Math.sin(((i + 1) / 24) * Math.PI * 2) * 5
      finalVal = Math.max(0, Math.min(500, finalVal + dailyCycle))

      predictions.push({
        step: i,
        time: `+${i}h`,
        actual: null,
        forecast: Number(finalVal.toFixed(1))
      })

      // Shift window forward: remove oldest, push newly predicted value
      currentWindow.shift()
      currentWindow.push(predictedValue)

      // Cleanup Tensors to prevent memory leaks
      inputTensor.dispose()
      prediction.dispose()
    }

    // Cleanup Training Tensors
    xs.dispose()
    ys.dispose()
    model.dispose()

    setTfForecast(predictions)
    setIsTraining(false)
  }

  // ─── Data Preparation ──────────────────────────────────────────────────────
  const transformedHistory = useMemo(() => history.map(r => ({
    ...r, pm25_ug: +((r.pm25 || 0) * 1000).toFixed(2), co_ppm: +adcToCOppm(r.co), smoke_pct: +((r.smoke / 1023) * 100).toFixed(1),
  })), [history])

  const aqi = current ? Math.round(current.aqi) : null
  const nano = current ? Math.round(current.nano_index) : null
  const aqiLevel = aqi ? getAQILevel(aqi) : null
  const nanoLevel = nano ? getNanoLevel(nano) : null
  const recommendations = useMemo(() => current ? getHealthRecommendations(aqi, nano, current.smoke, current.co) : [], [aqi, nano, current])

  // Chart Data compilation (Merge History with TF Forecast or Fallback Math Forecast)
  const chartData = useMemo(() => {
    let forecasts = tfForecast || forecast24Hours(history, 'nano_index')
    if (history.length < 5 || forecasts.length === 0) return []
    
    // Grab only the last 15 points for visual clarity on the chart
    const past = history.slice(-15).map(d => ({
      time: d.time, actual: +Number(d.nano_index).toFixed(1), forecast: null
    }))
    const bridge = {
      time: past[past.length - 1]?.time, actual: past[past.length - 1]?.actual, forecast: past[past.length - 1]?.actual
    }
    return [...past, bridge, ...forecasts]
  }, [history, tfForecast])

  const tabBtn = (id) => ({
    padding: '.42rem .9rem', borderRadius: 7, cursor: 'pointer', fontSize: '.8rem',
    border: `1px solid ${tab === id ? T.cyan + '55' : 'transparent'}`, background: tab === id ? T.cyan + '18' : 'transparent',
    color: tab === id ? T.cyan : T.textSub, fontFamily: 'inherit', transition: 'all .18s', whiteSpace: 'nowrap'
  })

  return (
    <div style={{ minHeight: '100vh', background: T.bg0, color: T.text, fontFamily: '"Outfit", "Segoe UI", sans-serif' }}>
      
      {/* Header */}
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.border}`, padding: '.85rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ color: T.cyan, fontSize: '1.2rem', textShadow: `0 0 12px ${T.cyan}88` }}>◈</span>
          Smart Air Quality Monitor
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.border}`, padding: '.4rem 1.5rem', display: 'flex', gap: '.3rem', overflowX: 'auto' }}>
        {[{ id: 'dashboard', label: '📊 Dashboard' }, { id: 'forecast', label: '🧠 AI Forecast' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabBtn(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.1rem 1.4rem' }}>
        
        {/* DASHBOARD TAB */}
        {tab === 'dashboard' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '130px' : '155px'}, 1fr))`, gap: '.75rem', marginBottom: '1.1rem' }}>
              {SENSORS.map(s => <MetricCard key={s.key} sensor={s} value={transformedHistory[transformedHistory.length - 1]?.[s.key]} />)}
            </div>
            <HealthPanel recommendations={recommendations} />
          </>
        )}

        {/* AI FORECAST TAB */}
        {tab === 'forecast' && (
          <div style={{ background: T.bg2, borderRadius: 12, padding: '1.2rem 1.4rem', border: `1px solid ${T.border}`, marginBottom: '1.2rem' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: T.text }}>🧠 TensorFlow.js On-Device ML</div>
                <div style={{ fontSize: '.8rem', color: T.textSub, marginTop: '.2rem' }}>
                  {tfForecast ? "Showing Neural Network Prediction" : "Showing basic math regression. Train AI for better accuracy."}
                </div>
              </div>

              {/* Training Button & Progress */}
              <div style={{ minWidth: '200px' }}>
                <button 
                  onClick={trainAIModel} 
                  disabled={isTraining || history.length < 10}
                  style={{
                    width: '100%', background: isTraining ? T.bg3 : T.purple, color: '#fff', 
                    border: 'none', padding: '.6rem 1rem', borderRadius: '8px', cursor: isTraining ? 'wait' : 'pointer',
                    fontWeight: 600, fontSize: '.85rem'
                  }}
                >
                  {isTraining ? `Training Neural Net... ${trainingProgress}%` : '🚀 Train AI Model Now'}
                </button>
                
                {isTraining && (
                  <div style={{ width: '100%', background: T.bg0, height: '6px', borderRadius: '4px', marginTop: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${trainingProgress}%`, background: T.cyan, height: '100%', transition: 'width 0.2s' }}></div>
                  </div>
                )}
              </div>
            </div>

            {/* Recharts Graph */}
            <div style={{ width: '100%', height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                  <XAxis dataKey="time" tick={{ fill: T.textMuted, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: T.textMuted, fontSize: 10 }} />
                  <Tooltip {...TT} />
                  
                  {/* Actual History Line */}
                  <Line type="monotone" dataKey="actual" stroke={T.cyan} strokeWidth={2} dot={false} connectNulls={false} name="Actual Nano Index" />
                  
                  {/* AI Forecast Line */}
                  <Line type="monotone" dataKey="forecast" stroke={T.purple} strokeWidth={3} strokeDasharray="6 3" dot={false} connectNulls={false} name="AI Prediction" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
