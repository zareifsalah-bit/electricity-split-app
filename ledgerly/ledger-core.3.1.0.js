export const APP_VERSION = '3.1.0';
export const SCHEMA_VERSION = 4;
export const CURRENCY = 'SAR';
export const HALALAS_PER_SAR = 100;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function nowIso() { return new Date().toISOString(); }
export function todayLocal() {
  const d = new Date();
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
export function uid(prefix='id') {
  const rand = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  return `${prefix}_${Date.now().toString(36)}_${rand.replace(/-/g,'').slice(0,12)}`;
}
export function deepClone(v) { return JSON.parse(JSON.stringify(v)); }
export function clamp(v,min,max){ return Math.min(max,Math.max(min,v)); }

export function normalizeNumericInput(value) {
  let s = String(value ?? '').trim();
  s = [...s].map(ch => {
    const ai = ARABIC_DIGITS.indexOf(ch); if (ai >= 0) return String(ai);
    const ei = EASTERN_DIGITS.indexOf(ch); if (ei >= 0) return String(ei);
    if (ch === '٫') return '.';
    if (ch === '٬') return ',';
    return ch;
  }).join('');
  s = s.replace(/\s/g,'');
  if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) s = `${parts[0]}.${parts[1]}`;
    else s = s.replace(/,/g,'');
  } else s = s.replace(/,/g,'');
  return s;
}

export function sarToHalalas(value) {
  const n = Number(normalizeNumericInput(value));
  if (!Number.isFinite(n)) return NaN;
  return Math.round((n + Number.EPSILON) * HALALAS_PER_SAR);
}
export function halalasToSar(value) { return Number(value || 0) / HALALAS_PER_SAR; }
export function validHalalas(v) { return Number.isSafeInteger(Number(v)) && Number(v) > 0; }
export function formatSAR(halalas, privacy=false) {
  if (privacy) return '••••';
  const amount = halalasToSar(halalas);
  return `${CURRENCY} ${amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
export function formatNumber(halalas) {
  return halalasToSar(halalas).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
export function normalizeName(name) {
  return String(name || '').normalize('NFKC').trim().replace(/[’‘`]/g,"'").replace(/\s+/g,' ').toLocaleLowerCase('en-US');
}
export function initials(name) {
  return String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase();
}
export function safeDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
export function shortDate(value, locale='en-GB') {
  const d = safeDate(value); if (!d) return '—';
  const [y,m,day] = d.split('-').map(Number);
  return new Date(y,m-1,day).toLocaleDateString(locale,{day:'2-digit',month:'short',year:'numeric'});
}
export function shortDateTime(value, locale='en-GB') {
  if (!value) return '—'; const d = new Date(value); if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

export function newEmptyState() {
  const ts = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ledgerId: uid('ledger'), revision: 0, createdAt: ts, updatedAt: ts,
      currency: CURRENCY, appVersion: APP_VERSION, lastBackupAt: null, lastBackupRevision: null,
      migratedFrom: null, storageModel: 'indexeddb-v3', lastMonthlyClose: null
    },
    creditors: [],
    transactions: [],
    audit: [],
    auditArchive: [],
    monthClosures: [],
    templates: [],
    settings: {
      theme: 'system', language: 'en', privacyLevel: 'none', compact: false,
      autoLockMinutes: 15, lockOnBackground: true, duplicateWarnings: true,
      autoAllocation: 'oldest-first', reduceMotion: false, onboarded: false
    }
  };
}

export function txBase({creditorId,type,amountHalalas,effectiveDate=todayLocal()}) {
  const ts = nowIso();
  return {
    id: uid('tx'), creditorId, type, amountHalalas: Number(amountHalalas), effectiveDate: safeDate(effectiveDate) || todayLocal(),
    createdAt: ts, updatedAt: ts, createdByVersion: APP_VERSION, modifiedByVersion: APP_VERSION,
    category: 'Personal', quality: 'Confirmed', description: '', notes: '', priority: 'Medium', dueDate: '',
    plan: { amountHalalas:0, frequency:'Monthly', nextDate:'', targetDate:'' },
    verified:false, verificationSource:'', verifiedAt:'', method:'', reference:'', attachments:[], attachmentIds:[], allocations:[], allocationMode:'manual',
    adjustmentDirection:'increase', reversedTransactionId:null,
    voidedAt:null, voidReason:null, voidedByVersion:null
  };
}

export function txEffect(state, tx, seen=new Set()) {
  if (!tx || tx.voidedAt) return 0;
  if (seen.has(tx.id)) return 0;
  seen.add(tx.id);
  const amt = Number(tx.amountHalalas || 0);
  if (tx.type === 'debt') return amt;
  if (tx.type === 'payment' || tx.type === 'waiver') return -amt;
  if (tx.type === 'adjustment') return tx.adjustmentDirection === 'decrease' ? -amt : amt;
  if (tx.type === 'reversal') {
    const target = state.transactions.find(t => t.id === tx.reversedTransactionId);
    return target ? -txEffect(state,target,seen) : amt;
  }
  return 0;
}

export function activeTransactions(state, creditorId=null, asOf=null) {
  return state.transactions.filter(tx => {
    if (creditorId && tx.creditorId !== creditorId) return false;
    if (tx.voidedAt) return false;
    if (asOf && safeDate(tx.effectiveDate) > safeDate(asOf)) return false;
    return true;
  });
}

export function creditorSummary(state, creditorId, asOf=null) {
  const creditor = state.creditors.find(c => c.id === creditorId);
  const txs = activeTransactions(state,creditorId,asOf);
  let original = 0, paid = 0, waivers = 0, adjustments = 0;
  for (const tx of txs) {
    const eff = txEffect(state,tx);
    if (tx.type === 'debt') original += eff;
    else if (tx.type === 'payment') paid += Math.abs(eff);
    else if (tx.type === 'waiver') waivers += Math.abs(eff);
    else if (tx.type === 'adjustment') adjustments += eff;
    else if (tx.type === 'reversal') {
      const target = state.transactions.find(t => t.id === tx.reversedTransactionId);
      if (target?.type === 'payment') paid += eff < 0 ? Math.abs(eff) : -Math.abs(eff);
      else if (target?.type === 'waiver') waivers += eff < 0 ? Math.abs(eff) : -Math.abs(eff);
      else adjustments += eff;
    }
  }
  const liability = original + adjustments;
  const reductions = paid + waivers;
  const remaining = Math.max(0, liability - reductions);
  const progress = liability > 0 ? clamp((reductions/liability)*100,0,100) : 0;
  const status = remaining <= 0 ? 'Paid' : reductions > 0 ? 'Partially Paid' : 'Outstanding';
  const debtCount = txs.filter(t=>t.type==='debt').length;
  const paymentCount = txs.filter(t=>t.type==='payment').length;
  const disputed = txs.some(t => t.quality === 'Disputed');
  const dueDates = txs.filter(t=>t.type==='debt' && t.dueDate).map(t=>t.dueDate).sort();
  const nextDue = dueDates.find(d => d >= todayLocal()) || dueDates[dueDates.length-1] || '';
  return { creditor, transactions: txs, original, adjustments, liability, paid, waivers, reductions, remaining, progress, status, debtCount, paymentCount, disputed, nextDue };
}

export function overallSummary(state, asOf=null) {
  const summaries = state.creditors.filter(c=>!c.archivedAt || asOf).map(c=>creditorSummary(state,c.id,asOf));
  const total = key => summaries.reduce((s,x)=>s + Number(x[key]||0),0);
  const liability = total('liability'); const reductions = total('reductions'); const remaining = Math.max(0, liability-reductions);
  return { summaries, original:total('original'), adjustments:total('adjustments'), liability, paid:total('paid'), waivers:total('waivers'), reductions, remaining,
    progress: liability>0 ? clamp(reductions/liability*100,0,100):0,
    active:summaries.filter(x=>x.remaining>0).length, completed:summaries.filter(x=>x.remaining<=0).length,
    disputed:summaries.filter(x=>x.disputed).length };
}

export function debtRemaining(state, debtId) {
  const debt = state.transactions.find(t=>t.id===debtId && t.type==='debt'); if (!debt || debt.voidedAt) return 0;
  const allocated = state.transactions.filter(t=>!t.voidedAt && ['payment','waiver'].includes(t.type)).reduce((sum,tx)=>{
    const reversed = state.transactions.some(r=>!r.voidedAt && r.type==='reversal' && r.reversedTransactionId===tx.id);
    if(reversed) return sum;
    return sum + (tx.allocations||[]).filter(a=>a.debtId===debtId).reduce((s,a)=>s+Number(a.amountHalalas||0),0);
  },0);
  return Math.max(0, Number(debt.amountHalalas)-allocated);
}

export function allocateReduction(state, creditorId, amountHalalas, strategy='oldest-first', preferredDebtId='') {
  let remaining = Number(amountHalalas);
  const debts = state.transactions.filter(t=>t.creditorId===creditorId && t.type==='debt' && !t.voidedAt)
    .map(t=>({tx:t,remaining:debtRemaining(state,t.id)})).filter(x=>x.remaining>0);
  if (preferredDebtId) debts.sort((a,b)=>Number(b.tx.id===preferredDebtId)-Number(a.tx.id===preferredDebtId));
  else if (strategy === 'smallest-balance') debts.sort((a,b)=>a.remaining-b.remaining || a.tx.effectiveDate.localeCompare(b.tx.effectiveDate));
  else if (strategy === 'highest-priority') {
    const p={High:0,Medium:1,Low:2}; debts.sort((a,b)=>(p[a.tx.priority]??1)-(p[b.tx.priority]??1) || a.tx.effectiveDate.localeCompare(b.tx.effectiveDate));
  } else debts.sort((a,b)=>(a.tx.dueDate||a.tx.effectiveDate).localeCompare(b.tx.dueDate||b.tx.effectiveDate) || a.tx.createdAt.localeCompare(b.tx.createdAt));
  const allocations=[];
  for (const d of debts) { if (remaining<=0) break; const use=Math.min(remaining,d.remaining); if (use>0) allocations.push({debtId:d.tx.id,amountHalalas:use}); remaining-=use; }
  return {allocations,unallocated:remaining};
}

export function categoryBalances(state) {
  const out = new Map();
  const add=(key,val)=>out.set(key,(out.get(key)||0)+val);
  for (const tx of state.transactions.filter(t=>!t.voidedAt)) {
    if (tx.type === 'debt') add(tx.category||'Other',Number(tx.amountHalalas||0));
    else if (tx.type === 'adjustment') add(tx.category||'Other',tx.adjustmentDirection==='decrease'?-Number(tx.amountHalalas||0):Number(tx.amountHalalas||0));
    else if (tx.type === 'payment' || tx.type === 'waiver') {
      const reversed=state.transactions.some(r=>!r.voidedAt&&r.type==='reversal'&&r.reversedTransactionId===tx.id); if(reversed) continue;
      let allocated=0; for(const a of tx.allocations||[]){const debt=state.transactions.find(d=>d.id===a.debtId);add(debt?.category||'Unallocated',-Number(a.amountHalalas||0));allocated+=Number(a.amountHalalas||0);} const rem=Number(tx.amountHalalas||0)-allocated;if(rem>0)add('Unallocated credits',-rem);
    } else if (tx.type === 'reversal') {
      const target=state.transactions.find(t=>t.id===tx.reversedTransactionId); if(!target||target.voidedAt) continue;
      if(target.type==='adjustment') add(target.category||'Other',target.adjustmentDirection==='decrease'?Number(target.amountHalalas||0):-Number(target.amountHalalas||0));
      // Payment/waiver reversals are handled by skipping the reversed source transaction above.
    }
  }
  return [...out.entries()].map(([category,remaining])=>({category,remaining:Math.max(0,remaining)})).filter(x=>x.remaining>0).sort((a,b)=>b.remaining-a.remaining);
}
export function monthlyHistory(state, months=12) {
  const now = new Date(); const result=[];
  for(let i=months-1;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i+1,0); const asOf=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const o=overallSummary(state,asOf); result.push({month:asOf.slice(0,7),asOf,remaining:o.remaining,paid:o.paid,liability:o.liability});
  }
  return result;
}

export function duplicateCandidates(state, creditorId, type, amountHalalas, effectiveDate) {
  const date=safeDate(effectiveDate); return state.transactions.filter(tx=>!tx.voidedAt && tx.creditorId===creditorId && tx.type===type && Number(tx.amountHalalas)===Number(amountHalalas) && Math.abs(dateDiffDays(tx.effectiveDate,date))<=2);
}
export function dateDiffDays(a,b){ const ad=new Date(`${safeDate(a)}T00:00:00`); const bd=new Date(`${safeDate(b)}T00:00:00`); return Number.isNaN(ad)||Number.isNaN(bd)?999:Math.round((ad-bd)/86400000); }

export function diagnostics(state) {
  const issues=[]; const creditorIds=new Set(); const txIds=new Set();
  for(const c of state.creditors){ if(!c.id) issues.push({level:'error',code:'creditor-id',message:'A creditor is missing an ID.'}); if(creditorIds.has(c.id)) issues.push({level:'error',code:'creditor-dup-id',message:`Duplicate creditor ID ${c.id}`}); creditorIds.add(c.id); if(!String(c.name||'').trim()) issues.push({level:'error',code:'creditor-name',message:`Creditor ${c.id} has no name.`}); }
  for(const tx of state.transactions){
    if(!tx.id||txIds.has(tx.id)) issues.push({level:'error',code:'tx-id',message:`Invalid or duplicate transaction ID ${tx.id||'(missing)'}`}); txIds.add(tx.id);
    if(!creditorIds.has(tx.creditorId)) issues.push({level:'error',code:'orphan',message:`Transaction ${tx.id} points to a missing creditor.`});
    if(!Number.isSafeInteger(Number(tx.amountHalalas))||Number(tx.amountHalalas)<=0) issues.push({level:'error',code:'amount',message:`Transaction ${tx.id} has an invalid amount.`});
    if(!['debt','payment','adjustment','waiver','reversal'].includes(tx.type)) issues.push({level:'error',code:'type',message:`Transaction ${tx.id} has an unsupported type.`});
    if(tx.type==='reversal' && !state.transactions.some(x=>x.id===tx.reversedTransactionId)) issues.push({level:'error',code:'reversal',message:`Reversal ${tx.id} points to a missing transaction.`});
    for(const a of tx.allocations||[]){const debt=state.transactions.find(x=>x.id===a.debtId && x.type==='debt');if(!debt)issues.push({level:'error',code:'allocation',message:`Transaction ${tx.id} has an orphan allocation.`});else if(debt.creditorId!==tx.creditorId)issues.push({level:'error',code:'cross-creditor-allocation',message:`Transaction ${tx.id} is allocated to a debt owned by another creditor.`});}
  }
  for(const c of state.creditors){ const s=creditorSummary(state,c.id); if(s.reductions>s.liability) issues.push({level:'error',code:'overpaid',message:`${c.name} has reductions above liability.`}); }
  return {ok:!issues.some(i=>i.level==='error'),issues};
}

export function validateState(state) {
  if(!state||typeof state!=='object') throw new Error('Ledger state is missing.');
  if(Number(state.schemaVersion)>SCHEMA_VERSION) { const e=new Error('This ledger was created by a newer Ledgerly version.'); e.code='NEWER_SCHEMA'; throw e; }
  if(Number(state.schemaVersion)!==SCHEMA_VERSION) throw new Error('Ledger schema requires migration.');
  if(!Array.isArray(state.creditors)||!Array.isArray(state.transactions)||!Array.isArray(state.audit)) throw new Error('Ledger structure is invalid.');
  const d=diagnostics(state); if(!d.ok){ const e=new Error('Ledger integrity checks failed.'); e.code='INTEGRITY'; e.diagnostics=d; throw e; }
  return true;
}

export function reconcileState(state) {
  const copy=deepClone(state); copy.schemaVersion=SCHEMA_VERSION; copy.meta=copy.meta||newEmptyState().meta; copy.settings={...newEmptyState().settings,...(copy.settings||{})};
  copy.creditors=copy.creditors||[]; copy.transactions=copy.transactions||[]; copy.audit=copy.audit||[]; copy.auditArchive=copy.auditArchive||[]; copy.monthClosures=copy.monthClosures||[]; copy.templates=copy.templates||[];
  copy.creditors.forEach(c=>{c.name=String(c.name||'').trim(); c.normalizedName=normalizeName(c.name); c.updatedAt=c.updatedAt||c.createdAt||nowIso(); c.createdAt=c.createdAt||c.updatedAt; if(c.archivedAt===undefined)c.archivedAt=null; c.aliases=Array.isArray(c.aliases)?c.aliases:[]; c.tags=Array.isArray(c.tags)?c.tags:[]; c.contact={phone:'',email:'',...(c.contact||{})}; c.notes=String(c.notes||'');});
  copy.transactions.forEach(tx=>{ tx.amountHalalas=Math.round(Number(tx.amountHalalas||0)); tx.effectiveDate=safeDate(tx.effectiveDate)||todayLocal(); tx.createdAt=tx.createdAt||nowIso(); tx.updatedAt=tx.updatedAt||tx.createdAt; tx.createdByVersion=tx.createdByVersion||APP_VERSION; tx.modifiedByVersion=APP_VERSION; tx.allocations=Array.isArray(tx.allocations)?tx.allocations:[]; tx.attachmentIds=Array.isArray(tx.attachmentIds)?tx.attachmentIds:[]; tx.verificationSource=String(tx.verificationSource||''); tx.verifiedAt=safeDate(tx.verifiedAt); tx.plan={amountHalalas:0,frequency:'Monthly',nextDate:'',targetDate:'',...(tx.plan||{})}; tx.voidedAt=tx.voidedAt||null; tx.voidReason=tx.voidReason||null; tx.quality=['Confirmed','Estimated','Disputed'].includes(tx.quality)?tx.quality:'Confirmed'; tx.priority=['High','Medium','Low'].includes(tx.priority)?tx.priority:'Medium'; if(tx.effectiveDateUnknown===undefined)tx.effectiveDateUnknown=(tx.id==='debt_saudi_energy_20261004'&&tx.createdByVersion==='migration-3.0.0'&&tx.effectiveDate==='2026-10-04');});
  return copy;
}

export function humanCsv(state) {
  const rows=[['Creditor','Status','Type','Effective Date','Amount SAR','Category','Quality','Description','Method','Reference','Voided','Notes']];
  const creditors=new Map(state.creditors.map(c=>[c.id,c]));
  for(const tx of [...state.transactions].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.createdAt.localeCompare(b.createdAt))){
    const c=creditors.get(tx.creditorId); const s=c?creditorSummary(state,c.id):null;
    rows.push([c?.name||'',s?.status||'',tx.type,tx.effectiveDate,formatNumber(tx.amountHalalas),tx.category||'',tx.quality||'',tx.description||'',tx.method||'',tx.reference||'',tx.voidedAt?'Yes':'No',tx.notes||'']);
  }
  return rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
}

export function paymentPlanEstimate(state, creditorId) {
  const s=creditorSummary(state,creditorId); const debts=s.transactions.filter(t=>t.type==='debt'&&!t.voidedAt);
  const planned=debts.reduce((sum,d)=>sum+Number(d.plan?.amountHalalas||0),0); if(planned<=0||s.remaining<=0) return null;
  const months=Math.ceil(s.remaining/planned); const target=new Date(); target.setMonth(target.getMonth()+months); return {plannedPerCycle:planned,cycles:months,targetDate:target.toISOString().slice(0,10)};
}

export function explainTotals(state) {
  return state.creditors.filter(c=>!c.archivedAt).map(c=>creditorSummary(state,c.id)).sort((a,b)=>b.remaining-a.remaining).map(s=>({name:s.creditor.name,liability:s.liability,reductions:s.reductions,remaining:s.remaining,status:s.status}));
}
