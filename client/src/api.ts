const API_ROOT=import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:4001`
const API=API_ROOT.replace(/\/$/,'') + (API_ROOT.endsWith('/api')?'':'/api')
async function request<T>(path:string, options:RequestInit={}):Promise<T>{
 const token=localStorage.getItem('porsball_token')
 const headers:Record<string,string>={'Content-Type':'application/json'}
 if(token) headers.Authorization=`Bearer ${token}`
 let res:Response
 try{res=await fetch(API+path,{...options,headers:{...headers,...(options.headers||{})}})}catch{throw new Error('\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21\u0e15\u0e48\u0e2d\u0e40\u0e0b\u0e34\u0e23\u0e4c\u0e1f\u0e40\u0e27\u0e2d\u0e23\u0e4c\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e15\u0e23\u0e27\u0e08\u0e2d\u0e1a\u0e27\u0e48\u0e32\u0e40\u0e0b\u0e34\u0e23\u0e4c\u0e1f\u0e40\u0e27\u0e2d\u0e23\u0e4c\u0e01\u0e33\u0e25\u0e31\u0e07\u0e17\u0e33\u0e07\u0e32\u0e19')}
 const text=await res.text(); let data:T & {error?:string}
 try{data=JSON.parse(text)}catch{throw new Error(res.ok?'\u0e40\u0e0b\u0e34\u0e23\u0e4c\u0e1f\u0e40\u0e27\u0e2d\u0e23\u0e4c\u0e15\u0e2d\u0e1a\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07':`\u0e40\u0e0b\u0e34\u0e23\u0e4c\u0e1f\u0e40\u0e27\u0e2d\u0e23\u0e4c\u0e15\u0e2d\u0e1a\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07 (${res.status})`)}
 if(!res.ok){
  let msg=data.error||`เซิร์ฟเวอร์ไม่พร้อมใช้งาน (${res.status})`
  if(res.status===401){
   localStorage.removeItem('porsball_token')
   window.dispatchEvent(new Event('porsball:auth-expired'))
   msg='เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'
  }
  throw new Error(msg)
 }
 return data as T
}
export type Venue={id:number;name:string;area:string;address:string;rating:number;price_per_hour:number;roof:number;field_types:string;owner_id?:number|null}
export type Slot={start:string;end:string;available:boolean}
export type Match={id:number;creator_id:number;title:string;venue_name:string;match_date:string;start_time:string;end_time:string;fee:number;max_players:number;players:number;booking_id:number;open_for_join:number}
export type MatchPlayer={id:number;name:string;owner:number}
export type Notification={id:number;type:string;title:string;message:string;read:number;created_at:string}
export type User={id:number;name:string;email:string;role:string;points:number;wins:number;losses:number;phone:string|null;address:string|null;avatar:string|null}
export type BookingRow={id:number;venue_id?:number|null;venue_name:string;booking_date:string;start_time:string;end_time:string;total_price:number;status:string;match_id?:number|null;open_for_join?:number|null}
export type OwnerBookingRow=BookingRow & {user_name:string;user_email:string}
export type SplitMember={id:number;name:string;paid:number;paid_at:string|null;amount:number}
export type SplitBill={id:number;booking_id:number;total_amount:number;share_count:number;share_amount:number;status:string;members:SplitMember[]}
export const api={
 venues:(q='')=>request<Venue[]>(`/venues?q=${encodeURIComponent(q)}`), slots:(id:number,date:string)=>request<{date:string;slots:Slot[]}>(`/venues/${id}/slots?date=${date}`), matches:()=>request<Match[]>('/matches'), me:()=>request<User>('/me'), notifications:()=>request<Notification[]>('/notifications'), readNotification:(id:number)=>request(`/notifications/${id}/read`,{method:'POST'}), readAllNotifications:()=>request('/notifications/read-all',{method:'POST'}),
 login:(email:string,password:string)=>request<{token:string;user:User}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})}), forgotPassword:(email:string)=>request<{message:string;devCode?:string}>('/auth/forgot-password',{method:'POST',body:JSON.stringify({email})}), resetPassword:(email:string,code:string,newPassword:string)=>request<{ok:boolean;message:string}>('/auth/reset-password',{method:'POST',body:JSON.stringify({email,code,newPassword})}), register:(name:string,email:string,password:string,phone:string,address:string)=>request<{token:string;user:User}>('/auth/register',{method:'POST',body:JSON.stringify({name,email,password,phone,address})}), updateProfile:(data:{name:string;phone:string;address:string;avatar:string|null})=>request<User>('/me',{method:'PATCH',body:JSON.stringify(data)}),
 book:(venueId:number,bookingDate:string,startTime:string,endTime:string,totalPrice:number)=>request('/bookings',{method:'POST',body:JSON.stringify({venueId,bookingDate,startTime,endTime,totalPrice})}), bookings:()=>request<BookingRow[]>('/bookings/me'), cancelBooking:(id:number)=>request(`/bookings/${id}/cancel`,{method:'POST'}), matchesMe:()=>request<Match[]>('/matches/me'), join:(id:number)=>request(`/matches/${id}/join`,{method:'POST'}), players:(id:number)=>request<{match:{creator_id:number;max_players:number;open_for_join:number};players:MatchPlayer[]}>(`/matches/${id}/players`), leaveMatch:(id:number)=>request(`/matches/${id}/leave`,{method:'POST'}), removePlayer:(matchId:number,userId:number)=>request(`/matches/${matchId}/players/${userId}`,{method:'DELETE'}),
 createMatch:(bookingId:number,title:string,fee:number,maxPlayers:number)=>request('/matches',{method:'POST',body:JSON.stringify({bookingId,title,fee,maxPlayers})}), openMatch:(id:number)=>request(`/matches/${id}/open`,{method:'POST'}), closeMatch:(id:number)=>request(`/matches/${id}/close`,{method:'POST'}), ownerVenues:()=>request<Venue[]>('/owner/venues'), ownerBookings:()=>request<OwnerBookingRow[]>('/owner/bookings'), adminUsers:()=>request<User[]>('/admin/users'), updateAdminRole:(id:number,role:string)=>request<User>(`/admin/users/${id}/role`,{method:'PATCH',body:JSON.stringify({role})}), assignVenueOwner:(id:number,ownerId:number|null)=>request<Venue>(`/admin/venues/${id}/owner`,{method:'PATCH',body:JSON.stringify({ownerId})}), updateOwnerVenue:(id:number,data:Partial<Pick<Venue,'name'|'area'|'address'|'price_per_hour'|'roof'|'field_types'>>)=>request<Venue>(`/owner/venues/${id}`,{method:'PATCH',body:JSON.stringify(data)}),
 createSplit:(bookingId:number,shareCount:number,names:string[])=>request<{id:number;shareAmount:number;shareCount:number;totalAmount:number}>('/split-bills',{method:'POST',body:JSON.stringify({bookingId,shareCount,names})}), split:(id:number)=>request<SplitBill>(`/split-bills/${id}`), splitForBooking:(bookingId:number)=>request<SplitBill>(`/split-bills/booking/${bookingId}`), markPaid:(billId:number,memberId:number)=>request(`/split-bills/${billId}/members/${memberId}/pay`,{method:'POST'}), closeSplit:(id:number)=>request(`/split-bills/${id}/close`,{method:'POST'}), shareLinks:(id:number)=>request<{billId:number;links:{memberId:number;name:string;token:string}[]}>(`/split-bills/${id}/share-links`,{method:'POST'}), splitGuest:(token:string)=>request<{bill_id:number;total_amount:number;member_id:number;name:string;amount:number;paid:number;booking_date:string;start_time:string;end_time:string;venue_name:string}>(`/split-bills/share/${token}`), payGuest:(token:string)=>request<{ok:boolean;message:string}>(`/split-bills/share/${token}/pay`,{method:'POST'})
}



