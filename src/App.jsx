import { useEffect, useState } from 'react'
import { ref, onValue, query, limitToLast } from 'firebase/database'
import { db } from './firebase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getAQILevel, getNanoLevel, predictNext } from './utils/calculations'

function MetricCard({ label, value, unit, color }) {
  return (
    <div style={{ background:'#1e293b', borderRadius:12, padding:'1.2rem',
                  border:'1px solid #334155', textAlign:'center' }}>
      <div style={{ fontSize:'.75rem', color:'#94a3b8', marginBottom:'.3rem' }}>{label}</div>
      <div style={{ fontSize:'2rem', fontWeight:700, color: color || '#e2e8f0' }}>{value ?? '--'}</div>
      <div style={{ fontSize:'.78rem', color:'#64748b' }}>{unit}</div>
    </div>
  )
}

function Chart({ data, dataKey, color, label }) {
  return (
    <div style={{ background:'#1e293b', borderRadius:12, padding:'1rem',
                  border:'1px solid #334155' }}>
      <div style={{ fontSize:'.85rem', color:'#94a3b8', marginBottom:'.8rem' }}>{label}</div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="time" tick={{ fill:'#64748b', fontSize:11 }} />
          <YAxis tick={{ fill:'#64748b', fontSize:11 }} />
          <Tooltip contentStyle={{ background:'#0f172a', border:'1px solid #334155', color:'#e2e8f0' }} />
          <Line type="monotone" dataKey={dataKey} stroke={color}
                strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function App() {
  const [current,  setCurrent]  = useState(null)
  const [history,  setHistory]  = useState([])
  const [lastSeen, setLastSeen] = useState(null)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  // Listen to current reading (live)
  useEffect(() => {
    const currentRef = ref(db, 'readings/current')
    return onValue(currentRef, snap => {
      if (snap.exists()) {
        setCurrent(snap.val())
        setLastSeen(new Date().toLocaleTimeString())
      }
    })
  }, [])

  // Listen to last 30 history readings (for charts)
  useEffect(() => {
    const histRef = query(ref(db, 'readings/history'), limitToLast(30))
    return onValue(histRef, snap => {
      if (snap.exists()) {
        const entries = Object.values(snap.val()).map(r => ({
          ...r,
          time: new Date(r.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
        }))
        setHistory(entries)
      }
    })
  }, [])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const aqi      = current ? Math.round(current.aqi) : null
  const nano     = current ? Math.round(current.nano_index) : null
  const aqiLevel = aqi  ? getAQILevel(aqi)  : null
  const nanoLevel= nano ? getNanoLevel(nano) : null
  const nanoPred = predictNext(history, 'nano_index')

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', color:'#e2e8f0',
                  fontFamily:'Segoe UI, sans-serif' }}>
      {/* Header */}
      <div style={{ background:'#1e293b', padding:'1rem 2rem',
                    borderBottom:'1px solid #334155' }}>
        <h1 style={{ fontSize:'1.2rem', fontWeight:600, margin:0 }}>
          🌬 Smart Air Quality Monitor
        </h1>
        <p style={{ fontSize:'.8rem', color:'#64748b', margin:'.2rem 0 0' }}>
          IoT-Driven · Nanoparticle Prediction · Firebase Real-time
          {lastSeen && <span style={{ marginLeft:12 }}>Last update: {lastSeen}</span>}
        </p>
      </div>

      <div style={{ maxWidth:960, margin:'0 auto', padding:'1.5rem' }}>

        {/* Status Banner */}
        {aqiLevel && (
          <div style={{ background: aqiLevel.color + '22', border:`1px solid ${aqiLevel.color}44`,
                        borderRadius:10, padding:'.8rem 1.2rem', marginBottom:'1.5rem',
                        display:'flex', alignItems:'center', gap:'1rem' }}>
            <span style={{ fontSize:'1.5rem' }}>
              {aqi <= 50 ? '😊' : aqi <= 100 ? '😐' : aqi <= 150 ? '😷' : '🚨'}
            </span>
            <div>
              <div style={{ fontWeight:600, color: aqiLevel.color }}>
                Air Quality: {aqiLevel.label}
              </div>
              <div style={{ fontSize:'.85rem', color:'#94a3b8' }}>
                AQI {aqi} · Nano Index {nano} ({nanoLevel?.label})
              </div>
            </div>
            {nanoPred && (
              <div style={{ marginLeft:'auto', textAlign:'right' }}>
                <div style={{ fontSize:'.75rem', color:'#94a3b8' }}>Predicted next nano</div>
                <div style={{ fontSize:'1.3rem', fontWeight:700, color:'#a78bfa' }}>
                  {nanoPred}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metric Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',
                      gap:'1rem', marginBottom:'1.5rem' }}>
          <MetricCard label="AQI"          value={aqi}                         unit="Air Quality Index"  color={aqiLevel?.color} />
          <MetricCard label="Nano Index"   value={nano}                        unit="0–500 scale"        color={nanoLevel?.color} />
          <MetricCard label="PM2.5"        value={current ? (current.pm25 * 1000).toFixed(1) : null} unit="µg/m³"  color="#38bdf8" />
          <MetricCard label="Temperature"  value={current?.temperature}        unit="°C"                 color="#fb923c" />
          <MetricCard label="Humidity"     value={current?.humidity}           unit="% RH"               color="#34d399" />
          <MetricCard label="CO (MQ-7)"    value={current?.co}                 unit="ADC raw"            color="#f472b6" />
        </div>

        {/* Charts */}
        {history.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <Chart data={history} dataKey="aqi"        color="#38bdf8" label="AQI over time" />
            <Chart data={history} dataKey="nano_index" color="#a78bfa" label="Nano index over time" />
          </div>
        )}

        {!current && (
          <div style={{ textAlign:'center', padding:'4rem', color:'#475569' }}>
            Waiting for sensor data from ESP32...
          </div>
        )}
      </div>
    </div>
  )
}
