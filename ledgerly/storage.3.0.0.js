import { nowIso, deepClone } from './ledger-core.3.0.0.js';

const DB_NAME='ledgerly.production.v3';
const DB_VERSION=4;
const STATE_STORE='state';
const SNAPSHOT_STORE='snapshots';
const ATTACHMENT_STORE='attachments';
const JOURNAL_STORE='journal';
const META_STORE='meta';
const DRAFT_STORE='drafts';
const BC_NAME='ledgerly-revision-v3';

export class RevisionConflictError extends Error { constructor(message='A newer ledger revision exists on this device.'){super(message);this.name='RevisionConflictError';this.code='REVISION_CONFLICT';} }

export function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains(SNAPSHOT_STORE)){ const s=db.createObjectStore(SNAPSHOT_STORE,{keyPath:'id'}); s.createIndex('createdAt','createdAt'); }
      if(!db.objectStoreNames.contains(ATTACHMENT_STORE)){ const a=db.createObjectStore(ATTACHMENT_STORE,{keyPath:'id'}); a.createIndex('transactionId','transactionId'); a.createIndex('creditorId','creditorId'); }
      if(!db.objectStoreNames.contains(JOURNAL_STORE)){ const j=db.createObjectStore(JOURNAL_STORE,{keyPath:'id'}); j.createIndex('status','status'); j.createIndex('createdAt','createdAt'); }
      if(!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}

function txDone(tx){ return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));}); }
function reqResult(req){ return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }

export async function requestPersistentStorage(){
  try { if(!navigator.storage?.persist) return {supported:false,persisted:false}; const persisted=await navigator.storage.persist(); return {supported:true,persisted}; } catch { return {supported:true,persisted:false}; }
}
export async function storageEstimate(){
  try { const e=await navigator.storage?.estimate?.(); return {usage:Number(e?.usage||0),quota:Number(e?.quota||0),persisted:await navigator.storage?.persisted?.()}; } catch { return {usage:0,quota:0,persisted:false}; }
}

export async function getStateRecord(){ const db=await openDb(); try{ const tx=db.transaction(STATE_STORE,'readonly'); const rec=await reqResult(tx.objectStore(STATE_STORE).get('current')); await txDone(tx); return rec||null; } finally{db.close();} }
export async function getMeta(id){const db=await openDb();try{const tx=db.transaction(META_STORE,'readonly');const v=await reqResult(tx.objectStore(META_STORE).get(id));await txDone(tx);return v||null;}finally{db.close();}}
export async function setMeta(id,value){const db=await openDb();try{const tx=db.transaction(META_STORE,'readwrite');tx.objectStore(META_STORE).put({id,value,updatedAt:nowIso()});await txDone(tx);}finally{db.close();}}

export async function saveStateRecord(record,{expectedRevision=null,snapshotReason=null,operationId=null}={}){
  const run=async()=>{
    const db=await openDb();
    try{
      const stores=[STATE_STORE,SNAPSHOT_STORE,JOURNAL_STORE];
      const tx=db.transaction(stores,'readwrite'); const stateStore=tx.objectStore(STATE_STORE); const snapStore=tx.objectStore(SNAPSHOT_STORE); const journalStore=tx.objectStore(JOURNAL_STORE);
      const current=await reqResult(stateStore.get('current'));
      const currentRev=Number(current?.revision||0);
      if(expectedRevision!==null && current && currentRev!==Number(expectedRevision)){tx.abort();throw new RevisionConflictError();}
      const next={...record,id:'current',revision:Number(record.revision??currentRev+1),savedAt:nowIso()};
      if(snapshotReason && current){snapStore.put({id:`snapshot_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,createdAt:nowIso(),reason:snapshotReason,revision:currentRev,record:deepClone(current)});}
      stateStore.put(next);
      if(operationId) journalStore.put({id:operationId,status:'completed',completedAt:nowIso(),createdAt:nowIso()});
      await txDone(tx);
      broadcastRevision(next.revision);
      void pruneSnapshots(40);
      return next;
    }finally{db.close();}
  };
  if(navigator.locks?.request) return navigator.locks.request('ledgerly-write-lock',{mode:'exclusive'},run);
  return run();
}

export async function beginOperation({type,reason='',expectedRevision=null}){
  const id=`op_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; const db=await openDb();
  try{const tx=db.transaction(JOURNAL_STORE,'readwrite');tx.objectStore(JOURNAL_STORE).put({id,type,reason,expectedRevision,status:'pending',createdAt:nowIso()});await txDone(tx);return id;}finally{db.close();}
}
export async function failOperation(id,error){if(!id)return;const db=await openDb();try{const tx=db.transaction(JOURNAL_STORE,'readwrite');const s=tx.objectStore(JOURNAL_STORE);const rec=await reqResult(s.get(id));s.put({...rec,id,status:'failed',failedAt:nowIso(),error:String(error?.message||error||'Unknown error')});await txDone(tx);}finally{db.close();}}
export async function pendingOperations(){const db=await openDb();try{const tx=db.transaction(JOURNAL_STORE,'readonly');const all=await reqResult(tx.objectStore(JOURNAL_STORE).getAll());await txDone(tx);return (all||[]).filter(x=>x.status==='pending');}finally{db.close();}}

export async function createManualSnapshot(record,reason='Manual snapshot'){
  const db=await openDb();try{const tx=db.transaction(SNAPSHOT_STORE,'readwrite');tx.objectStore(SNAPSHOT_STORE).put({id:`snapshot_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,createdAt:nowIso(),reason,revision:Number(record?.revision||0),record:deepClone(record)});await txDone(tx);}finally{db.close();}
}
export async function listSnapshots(limit=20){const db=await openDb();try{const tx=db.transaction(SNAPSHOT_STORE,'readonly');const all=await reqResult(tx.objectStore(SNAPSHOT_STORE).getAll());await txDone(tx);return (all||[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit);}finally{db.close();}}
export async function getSnapshot(id){const db=await openDb();try{const tx=db.transaction(SNAPSHOT_STORE,'readonly');const r=await reqResult(tx.objectStore(SNAPSHOT_STORE).get(id));await txDone(tx);return r||null;}finally{db.close();}}
export async function pruneSnapshots(keep=40){const db=await openDb();try{const tx=db.transaction(SNAPSHOT_STORE,'readwrite');const s=tx.objectStore(SNAPSHOT_STORE);const all=await reqResult(s.getAll());const sorted=(all||[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));sorted.slice(keep).forEach(x=>s.delete(x.id));await txDone(tx);}finally{db.close();}}

export async function putAttachment(record){const db=await openDb();try{const tx=db.transaction(ATTACHMENT_STORE,'readwrite');tx.objectStore(ATTACHMENT_STORE).put(record);await txDone(tx);return record;}finally{db.close();}}
export async function getAttachment(id){const db=await openDb();try{const tx=db.transaction(ATTACHMENT_STORE,'readonly');const r=await reqResult(tx.objectStore(ATTACHMENT_STORE).get(id));await txDone(tx);return r||null;}finally{db.close();}}
export async function listAttachments({transactionId=null,creditorId=null}={}){const db=await openDb();try{const tx=db.transaction(ATTACHMENT_STORE,'readonly');const s=tx.objectStore(ATTACHMENT_STORE);let r;if(transactionId)r=await reqResult(s.index('transactionId').getAll(transactionId));else if(creditorId)r=await reqResult(s.index('creditorId').getAll(creditorId));else r=await reqResult(s.getAll());await txDone(tx);return r||[];}finally{db.close();}}
export async function deleteAttachment(id){const db=await openDb();try{const tx=db.transaction(ATTACHMENT_STORE,'readwrite');tx.objectStore(ATTACHMENT_STORE).delete(id);await txDone(tx);}finally{db.close();}}
export async function exportAllAttachments(){return listAttachments();}
export async function replaceAllAttachments(items=[]){const db=await openDb();try{const tx=db.transaction(ATTACHMENT_STORE,'readwrite');const s=tx.objectStore(ATTACHMENT_STORE);s.clear();for(const item of items)s.put(item);await txDone(tx);}finally{db.close();}}

export async function clearLegacyDatabase(){
  try{indexedDB.deleteDatabase('ledgerly.local.v2');}catch{}
}

let channel=null;
export function revisionChannel(callback){
  if(!('BroadcastChannel'in globalThis)) return ()=>{};
  channel=channel||new BroadcastChannel(BC_NAME); const handler=e=>callback?.(e.data); channel.addEventListener('message',handler); return()=>channel.removeEventListener('message',handler);
}
export function broadcastRevision(revision){try{channel=channel||new BroadcastChannel(BC_NAME);channel.postMessage({type:'revision',revision:Number(revision),at:nowIso()});}catch{}}
export async function clearSnapshots(){const db=await openDb();try{const tx=db.transaction(SNAPSHOT_STORE,'readwrite');tx.objectStore(SNAPSHOT_STORE).clear();await txDone(tx);}finally{db.close();}}

export async function saveDraft(record){const db=await openDb();try{const tx=db.transaction(DRAFT_STORE,'readwrite');tx.objectStore(DRAFT_STORE).put(record);await txDone(tx);}finally{db.close();}}
export async function getDraft(id){const db=await openDb();try{const tx=db.transaction(DRAFT_STORE,'readonly');const r=await reqResult(tx.objectStore(DRAFT_STORE).get(id));await txDone(tx);return r||null;}finally{db.close();}}
export async function deleteDraft(id){const db=await openDb();try{const tx=db.transaction(DRAFT_STORE,'readwrite');tx.objectStore(DRAFT_STORE).delete(id);await txDone(tx);}finally{db.close();}}
export async function clearDrafts(){const db=await openDb();try{const tx=db.transaction(DRAFT_STORE,'readwrite');tx.objectStore(DRAFT_STORE).clear();await txDone(tx);}finally{db.close();}}
