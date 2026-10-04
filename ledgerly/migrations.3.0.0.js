import { APP_VERSION, SCHEMA_VERSION, newEmptyState, txBase, sarToHalalas, normalizeName, nowIso, todayLocal, allocateReduction, reconcileState, uid } from './ledger-core.3.0.0.js';
import { legacyDecrypt } from './crypto.3.0.0.js';

export const LEGACY_STORAGE_KEY='ledgerly.debt-dashboard.v1';
export const LEGACY_SECURE_KEY='ledgerly.secure.v1';
export const LEGACY_SECURITY_CONFIG='ledgerly.security.v1';

function legacyDate(value){
  if(!value) return todayLocal();
  const s=String(value); const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  const d=new Date(value); if(Number.isNaN(d.getTime()))return todayLocal(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function migrateLegacyState(old){
  if(!old||!Array.isArray(old.creditors)||!Array.isArray(old.debts)||!Array.isArray(old.payments)) throw new Error('Legacy Ledgerly data was not recognized.');
  const state=newEmptyState(); const ts=nowIso(); state.meta.migratedFrom=`legacy-schema-${old.schemaVersion||1}`; state.meta.createdAt=old.creditors.map(c=>c.createdAt).filter(Boolean).sort()[0]||ts;
  const removedIds=new Set(old.creditors.filter(c=>normalizeName(c.name)==="samha's school").map(c=>c.id));
  state.creditors=old.creditors.filter(c=>!removedIds.has(c.id)).map(c=>({id:String(c.id||uid('cred')),name:String(c.name||'Unknown').trim(),normalizedName:normalizeName(c.name),aliases:[],tags:[],contact:{phone:'',email:''},notes:'',createdAt:c.createdAt||ts,updatedAt:c.updatedAt||c.createdAt||ts,archivedAt:null}));
  const validCreditorIds=new Set(state.creditors.map(c=>c.id));

  for(const d of old.debts){
    if(removedIds.has(d.creditorId)||!validCreditorIds.has(d.creditorId))continue;
    const tx={...txBase({creditorId:d.creditorId,type:'debt',amountHalalas:sarToHalalas(d.amount),effectiveDate:legacyDate(d.createdAt)}),
      id:String(d.id||uid('tx')), category:d.category||'Personal', quality:['Confirmed','Estimated','Disputed'].includes(d.quality)?d.quality:'Confirmed',
      description:d.description||'Migrated debt record',notes:d.notes||'',priority:['High','Medium','Low'].includes(d.priority)?d.priority:'Medium',dueDate:d.dueDate||'',
      plan:{amountHalalas:sarToHalalas(d.planAmount||0)||0,frequency:d.planFrequency||'Monthly',nextDate:'',targetDate:''},createdAt:d.createdAt||ts,updatedAt:d.updatedAt||d.createdAt||ts,createdByVersion:'legacy',modifiedByVersion:APP_VERSION};
    state.transactions.push(tx);
  }
  for(const p of old.payments){
    if(removedIds.has(p.creditorId)||!validCreditorIds.has(p.creditorId))continue;
    const amount=sarToHalalas(p.amount); const tx={...txBase({creditorId:p.creditorId,type:'payment',amountHalalas:amount,effectiveDate:legacyDate(p.dateTime||p.createdAt)}),
      id:String(p.id||uid('tx')),description:p.note||'Migrated payment',notes:p.note||'',method:p.method||'',reference:p.reference||'',verified:Boolean(p.verified),createdAt:p.createdAt||p.dateTime||ts,updatedAt:p.updatedAt||p.createdAt||p.dateTime||ts,createdByVersion:'legacy',modifiedByVersion:APP_VERSION,allocationMode:'migration-oldest-first'};
    const alloc=allocateReduction(state,p.creditorId,amount,'oldest-first'); tx.allocations=alloc.allocations; state.transactions.push(tx);
  }

  // One-time compatibility repair for the exact pre-update Electricity seed. It only runs when the old 600/2000/1400 trio is still present.
  const energy=state.creditors.find(c=>normalizeName(c.name)==='electricity');
  if(energy){
    const debts=state.transactions.filter(t=>t.creditorId===energy.id&&t.type==='debt'); const amounts=debts.map(t=>t.amountHalalas).sort((a,b)=>a-b);
    const legacyAmounts=[60000,140000,200000];
    const exact=amounts.length===3&&amounts.every((v,i)=>v===legacyAmounts[i]);
    if(exact){
      state.transactions=state.transactions.filter(t=>t.creditorId!==energy.id);
      energy.name='Saudi Energy Company'; energy.normalizedName=normalizeName(energy.name); energy.updatedAt=ts;
      const debt={...txBase({creditorId:energy.id,type:'debt',amountHalalas:262066,effectiveDate:'2026-10-04'}),id:'debt_saudi_energy_20261004',category:'Bills & Utilities',quality:'Confirmed',description:'Consolidated utility balance',priority:'High',createdByVersion:'migration-3.0.0'};
      state.transactions.push(debt);
      const payment={...txBase({creditorId:energy.id,type:'payment',amountHalalas:101000,effectiveDate:'2026-09-28'}),id:'payment_saudi_energy_20260928_1010',description:'Payment recorded for Saudi Energy Company',verified:true,allocationMode:'migration-oldest-first',allocations:[{debtId:debt.id,amountHalalas:101000}],createdByVersion:'migration-3.0.0'};
      state.transactions.push(payment);
    }
  }

  const theme=localStorage.getItem('ledgerly.theme'); if(['dark','light'].includes(theme))state.settings.theme=theme;
  const pref=old.preferences||{}; state.settings.privacyLevel=pref.privacy?'amounts':'none'; state.settings.compact=Boolean(pref.compact); state.settings.onboarded=true;
  state.audit=[...(old.auditLog||[]).slice(0,200).map(a=>({id:String(a.id||uid('audit')),ts:a.timestamp||ts,event:a.event||'Legacy activity',entityType:'legacy',entityId:null,creditorId:a.creditorId||null,details:a.detail||'',before:null,after:null,reason:'Migrated from Ledgerly legacy audit trail',prevHash:null,hash:null,appVersion:'legacy'})),
    {id:uid('audit'),ts,event:'Ledger migrated',entityType:'system',entityId:null,creditorId:null,details:`Migrated to schema ${SCHEMA_VERSION} / Ledgerly ${APP_VERSION}`,before:null,after:null,reason:'Automatic safe migration',prevHash:null,hash:null,appVersion:APP_VERSION}];
  state.meta.updatedAt=ts; return reconcileState(state);
}

export function detectLegacy(){
  let plain=null, secure=null, securityConfig=null;
  try{plain=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||'null');}catch{}
  try{secure=JSON.parse(localStorage.getItem(LEGACY_SECURE_KEY)||'null');}catch{}
  try{securityConfig=JSON.parse(localStorage.getItem(LEGACY_SECURITY_CONFIG)||'null');}catch{}
  if(secure?.data&&secure?.salt&&secure?.iv) return {type:'encrypted',envelope:secure,securityConfig};
  if(plain?.creditors&&plain?.debts) return {type:'plain',state:plain};
  return null;
}

export async function decryptAndMigrateLegacy(envelope,password){ return migrateLegacyState(await legacyDecrypt(envelope,password)); }

export function cleanupLegacyKeys({removeSecure=true,removePlain=true}={}){
  if(removePlain)localStorage.removeItem(LEGACY_STORAGE_KEY);
  if(removeSecure){localStorage.removeItem(LEGACY_SECURE_KEY);localStorage.removeItem(LEGACY_SECURITY_CONFIG);}
}

export async function recoverLegacyMirror(){
  return new Promise((resolve)=>{
    try{
      const req=indexedDB.open('ledgerly.local.v2');
      req.onerror=()=>resolve(null);
      req.onsuccess=()=>{
        const db=req.result; if(!db.objectStoreNames.contains('snapshots')){db.close();return resolve(null);} const tx=db.transaction('snapshots','readonly'); const r=tx.objectStore('snapshots').get('current');
        r.onsuccess=()=>{const item=r.result;db.close(); if(item?.payload?.creditors&&item?.payload?.debts)return resolve({type:'plain',state:item.payload,source:'legacy-indexeddb'}); resolve(null);}; r.onerror=()=>{db.close();resolve(null);};
      };
    }catch{resolve(null);}
  });
}
