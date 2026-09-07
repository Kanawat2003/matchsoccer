import {useCallback,useEffect,useMemo,useState} from 'react'
import {api} from './api'
import type {OwnerBookingRow} from './api'
import './OwnerBookings.css'

const statusLabel=(s:string)=>{const x=s.toUpperCase();return x==='CONFIRMED'?'ยืนยันแล้ว':x==='CANCELLED'?'ยกเลิกแล้ว':x==='COMPLETED'?'เสร็จสิ้น':x==='EXPIRED'?'หมดเวลา':x==='IN_PROGRESS'?'กำลังใช้งาน':x==='UPCOMING'?'กำลังจะถึง':s}
const dateLabel=(date:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(`${date}T00:00:00+07:00`))
const displayStatus=(b:OwnerBookingRow,now:number)=>{if(String(b.status).toUpperCase()==='CANCELLED')return 'CANCELLED';const start=new Date(`${b.booking_date}T${b.start_time}:00+07:00`).getTime();const end=new Date(`${b.booking_date}T${b.end_time}:00+07:00`).getTime();if(now<start)return 'UPCOMING';if(now<end)return 'IN_PROGRESS';return 'COMPLETED'}

export default function OwnerBookings(){
 const [rows,setRows]=useState<OwnerBookingRow[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[filter,setFilter]=useState('all'),[now,setNow]=useState(()=>Date.now())
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(timer)},[])
 const load=useCallback(async()=>{setLoading(true);setError('');try{setRows(await api.ownerBookings())}catch(e){setError(e instanceof Error?e.message:'โหลดรายการจองไม่สำเร็จ')}finally{setLoading(false)}},[])
 useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const onFocus=()=>void load();const onVisible=()=>{if(document.visibilityState==='visible')void load()};window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onVisible);const interval=window.setInterval(()=>void load(),30000);return()=>{window.clearTimeout(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible);window.clearInterval(interval)}},[load])
 const ordered=useMemo(()=>rows.slice().sort((a,b)=>{const rank=(x:OwnerBookingRow)=>{const s=displayStatus(x,now);return s==='UPCOMING'?0:s==='IN_PROGRESS'?1:s==='COMPLETED'?2:3};const diff=rank(a)-rank(b);return diff||`${b.booking_date}T${b.start_time}`.localeCompare(`${a.booking_date}T${a.start_time}`)}),[rows,now])
 const upcoming=ordered.filter(b=>displayStatus(b,now)==='UPCOMING').length
 const active=ordered.filter(b=>displayStatus(b,now)==='IN_PROGRESS').length
 const cancelled=ordered.filter(b=>displayStatus(b,now)==='CANCELLED').length
 const completed=ordered.filter(b=>displayStatus(b,now)==='COMPLETED').length
 const confirmed=ordered.filter(b=>String(b.status).toUpperCase()==='CONFIRMED')
 const revenue=confirmed.reduce((sum,b)=>sum+Number(b.total_price||0),0)
 const filtered=filter==='all'?ordered:ordered.filter(b=>displayStatus(b,now)===filter)
 return <section className="owner-bookings">
  <div className="section-head"><div><p className="eyebrow">BOOKINGS</p><h2>รายการจองสนาม</h2><p>ตรวจสอบลูกค้า วันเวลา ราคา และสถานะการจองของสนามคุณ</p></div><button type="button" className="link" onClick={()=>void load()} disabled={loading} aria-label="รีเฟรชรายการจอง">{loading?'กำลังโหลด...':'รีเฟรช'}</button></div>
  {error&&<div className="panel owner-error">{error}</div>}
  {loading&&!rows.length&&<div className="panel owner-empty">กำลังโหลดรายการจอง...</div>}
  {!loading&&!error&&!rows.length&&<div className="panel owner-empty">ยังไม่มีรายการจอง</div>}
  {!loading&&rows.length>0&&<div className="owner-booking-summary"><div className="panel"><b>{upcoming}</b><span>กำลังจะถึง</span></div><div className="panel"><b>{active}</b><span>กำลังใช้งาน</span></div><div className="panel"><b>{completed}</b><span>เสร็จสิ้น</span></div><div className="panel"><b>{cancelled}</b><span>ยกเลิกแล้ว</span></div><div className="panel owner-booking-revenue"><b>฿{revenue.toLocaleString()}</b><span>ยอดจองที่ยืนยัน</span></div></div>}
  {!loading&&!error&&rows.length>0&&<div className="owner-booking-filters" role="tablist" aria-label="กรองรายการจอง">{[['all','ทั้งหมด'],['UPCOMING','กำลังจะถึง'],['IN_PROGRESS','กำลังใช้งาน'],['COMPLETED','เสร็จสิ้น'],['CANCELLED','ยกเลิกแล้ว']].map(([value,label])=><button key={value} type="button" className={filter===value?'active':''} role="tab" aria-selected={filter===value} aria-controls="owner-booking-results" onClick={()=>setFilter(value)}>{label}</button>)}</div>}
  {!loading&&rows.length>0&&filtered.length===0&&<div className="panel owner-empty">ไม่มีรายการในหมวดนี้</div>}
  <div id="owner-booking-results" className="owner-booking-list" role="tabpanel" aria-live="polite">{filtered.map(b=>{const status=displayStatus(b,now);return <article className="panel owner-booking-card" key={b.id} aria-label={`การจอง ${b.venue_name} ${dateLabel(b.booking_date)} ${b.start_time}-${b.end_time}`}><div><h3>{b.venue_name}</h3><p>{dateLabel(b.booking_date)} • {b.start_time}–{b.end_time}</p></div><div className="owner-booking-user"><strong>{b.user_name}</strong><span>{b.user_email}</span></div><div className="sr-only">หมายเลขการจอง {b.id}</div><div className="owner-booking-price"><b>฿{b.total_price.toLocaleString()}</b><small className={'owner-status status-'+status.toLowerCase()}>{statusLabel(status)}</small></div></article>})}</div>
 </section>
}
