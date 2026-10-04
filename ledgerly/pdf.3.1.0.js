// Ledgerly 3.1.0 — dependency-free PDF report generator.
// Uses built-in PDF Helvetica fonts so reports work fully offline.
function ascii(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
}
function pdfEsc(value){return ascii(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
function moneyText(value){return ascii(value);}
function text(x,y,size,text,font='F1'){return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfEsc(text)}) Tj ET\n`;}
function line(x1,y1,x2,y2,w=.5){return `${w} w ${x1} ${y1} m ${x2} ${y2} l S\n`;}
function rect(x,y,w,h,gray=.96){return `${gray} g ${x} ${y} ${w} ${h} re f 0 g\n`;}
function pageContent(model,pageIndex,pageCount,bodyLines){
  let s='';
  s+=text(42,800,10,'LEDGERLY','F2');
  s+=text(42,783,20,pageIndex===0?'Personal Debt Report':'Personal Debt Report — continued','F2');
  s+=text(42,765,8,`${model.generated}  |  v${model.version}  |  revision ${model.revision}`,'F1');
  s+=line(42,754,553,754,.7);
  for(const cmd of bodyLines)s+=cmd;
  s+=line(42,42,553,42,.4);
  s+=text(42,28,7,'Private local ledger · actual records only · plans are excluded from balances','F1');
  s+=text(505,28,7,`${pageIndex+1}/${pageCount}`,'F1');
  return s;
}
function buildPages(model){
  const pages=[];
  let body=[]; let y=724;
  const pushPage=()=>{pages.push(body);body=[];y=724;};
  const ensure=(need=20)=>{if(y-need<58)pushPage();};
  const row=(cols,widths,{bold=false,size=8,height=17}={})=>{ensure(height);let x=42;cols.forEach((v,i)=>{body.push(text(x,y,size,v,bold?'F2':'F1'));x+=widths[i];});body.push(line(42,y-5,553,y-5,.25));y-=height;};

  body.push(rect(42,665,511,72,.95));
  body.push(text(56,716,8,'TOTAL LIABILITY','F1')); body.push(text(56,696,15,moneyText(model.summary.liability),'F2'));
  body.push(text(220,716,8,'PAID / SETTLED','F1')); body.push(text(220,696,15,moneyText(model.summary.paid),'F2'));
  body.push(text(390,716,8,'REMAINING','F1')); body.push(text(390,696,15,moneyText(model.summary.remaining),'F2'));
  y=645;
  body.push(text(42,y,12,'Creditor summary','F2')); y-=22;
  row(['Creditor','Original','Paid/Settled','Remaining','Status'],[190,82,92,84,63],{bold:true,size:7,height:18});
  for(const c of model.creditors)row([c.name,c.original,c.paid,c.remaining,c.status],[190,82,92,84,63],{size:7.5,height:17});
  ensure(40);y-=8;body.push(text(42,y,12,'Transaction detail','F2'));y-=22;
  row(['Date','Creditor','Type','Amount','Attachment'],[72,165,90,105,79],{bold:true,size:7,height:18});
  for(const tx of model.transactions){
    row([tx.date,tx.creditor,tx.type,tx.amount,tx.attachment],[72,165,90,105,79],{size:7.2,height:17});
    if(tx.description){ensure(14);body.push(text(116,y+2,6.5,tx.description,'F1'));y-=12;}
  }
  pages.push(body); return pages;
}
function pdfBytes(pageContents){
  const objects=[];const add=s=>{objects.push(s);return objects.length;};
  const catalog=add('');const pagesObj=add('');
  const font1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds=[];
  for(const content of pageContents){
    const stream=add(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}endstream`);
    const page=add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${stream} 0 R >>`);pageIds.push(page);
  }
  objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj-1]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out='%PDF-1.4\n%Ledgerly\n';const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets[i+1]=new TextEncoder().encode(out).length;out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=new TextEncoder().encode(out).length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  out+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}
export function buildLedgerPdf(model){
  const rawPages=buildPages(model);const count=rawPages.length;const rendered=rawPages.map((body,i)=>pageContent(model,i,count,body));return pdfBytes(rendered);
}
