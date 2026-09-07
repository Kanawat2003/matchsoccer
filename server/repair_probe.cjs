const samples=[
'เน"เธกเนˆเธžเธšเธชเธ™เธฒเธก',
'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเน‰เธญเธกเธนเธฅ'
];
for(const s of samples){
 for(const enc of ['latin1','utf8']){
  const b=Buffer.from(s,enc);
  for(const dec of ['utf8','latin1']) console.log(enc,dec,JSON.stringify(b.toString(dec)));
 }
}
