import {useCallback,useEffect,useState} from 'react'
import {api} from './api'
import type {RefundRequest} from './api'
export default function AdminRefunds(){
 const [rows,setRows]=useState<RefundRequest[]>([]),[error,setError]=useState('')
 const load=useCallback(async()=>{try{setRows(await api.adminRefunds());setError('')}catch(e){setError(e instanceof Error?e.message:'โหลดรายการคืนเงินที่ต้องตรวจสอบไม่สำเร็จ')}},[])
 useEffect(()=>{void load();const t=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(t)},[load])
 const label=(s:string)=>s==='overdue'?'เกินกำหนด':s==='disputed'?'ลูกค้าแจ้งปัญหา':s==='proof_submitted'?'รอลูกค้ายืนยันสลิป':'รอคืนเงิน'
 return <section className="panel admin-section"><div className="section-head"><div><h2>ติดตามเงินคืนและข้อพิพาท</h2><p>รายการคืนเงินที่ยังไม่เสร็จ โดยเฉพาะรายการเกินกำหนด 24 ชั่วโมง</p></div><button type="button" className="link" onClick={()=>void load()}>รีเฟรช</button></div>{error&&<div className="admin-error" role="alert">{error}</div>}{!error&&!rows.length&&<div className="admin-empty">ไม่มีรายการคืนเงินที่ต้องตรวจสอบ</div>}{rows.map(r=><article className="admin-row" key={r.id}><div><b>{r.venue_name} · #{r.booking_id}</b><small>ลูกค้า: {r.customer_name} · {r.customer_email}</small><small>เจ้าของสนาม: {r.owner_name||'ไม่พบเจ้าของสนาม'}</small><small>กำหนดคืนเงิน: {new Date(r.due_at).toLocaleString('th-TH')}</small></div><div><b>฿{r.refund_amount.toLocaleString()}</b><small>สถานะ: {label(r.status)}</small>{r.slip_data_url&&<a href={r.slip_data_url} target="_blank" rel="noreferrer">เปิดหลักฐานสลิป</a>}</div></article>)}</section>
}
