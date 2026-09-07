const MOJIBAKE_RE=/[ÃÂà-ÿ]|เธ.|เน.|เเธ|€|™|œ|š|‡|‰|›|‹|†|ƒ|\u0080-\u009F/
export const isBrokenThai = (value) => {
 if(typeof value !== 'string') return false
 if(value.includes('�') || /[\u0080-\u009F]/.test(value)) return true
 return MOJIBAKE_RE.test(value)
}
export const fallbackMessage = (status) => {
 if(status===400) return 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบข้อมูลแล้วลองใหม่อีกครั้ง'
 if(status===401) return 'กรุณาเข้าสู่ระบบใหม่'
 if(status===403) return 'คุณไม่มีสิทธิ์ดำเนินการนี้'
 if(status===404) return 'ไม่พบข้อมูลที่ต้องการ'
 if(status===409) return 'ไม่สามารถดำเนินการได้ กรุณาตรวจสอบข้อมูลแล้วลองใหม่'
 return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
}
export const safeBody = (body,status) => {
 if(body===null || typeof body!=='object') return body
 if(Array.isArray(body)) return body.map(v=>safeBody(v,status))
 const out={...body}
 if(isBrokenThai(out.error)) out.error=fallbackMessage(status)
 if(isBrokenThai(out.message)) out.message=fallbackMessage(status)
 return out
}
