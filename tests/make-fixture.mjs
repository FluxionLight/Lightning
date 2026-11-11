import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const dir = new URL("./fixtures/",import.meta.url);
await mkdir(dir,{recursive:true});
const objects=[];
const add=s=>{objects.push(s);return objects.length;};
add("<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /PageMode /UseOutlines >>");
add("<< /Type /Pages /Count 10 /Kids ["+Array.from({length:10},(_,i)=>`${7+i*2} 0 R`).join(" ")+"] >>");
add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
add("<< /Type /Outlines /First 5 0 R /Last 6 0 R /Count 2 >>");
add("<< /Title (Start reading) /Parent 4 0 R /Next 6 0 R /Dest [7 0 R /Fit] >>");
add("<< /Title (Landscape comparison) /Parent 4 0 R /Prev 5 0 R /Dest [23 0 R /Fit] >>");
for(let i=0;i<10;i++) {
  const w=i===8?720:420,h=i===8?420:i===5?980:594;
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${8+i*2} 0 R >>`);
  let stream=`q 0.988 0.984 0.965 rg 0 0 ${w} ${h} re f Q\nBT /F1 9 Tf 0.35 0.43 0.32 rg 34 ${h-35} Td (LIGHTNING / READING NOTES) Tj ET\nBT /F1 24 Tf 0.14 0.22 0.16 rg 34 ${h-84} Td (A little room to think.) Tj ET\nBT /F1 11 Tf 0.3 0.35 0.29 rg 34 ${h-116} Td (Chapter ${i+1} - A synthetic PDF for reader verification) Tj ET\n`;
  for(let line=0;line<Math.floor((h-190)/19);line++) stream+=`BT /F1 10 Tf 0.24 0.28 0.23 rg 34 ${h-158-line*19} Td (A quiet page gives an idea the space it needs to grow.) Tj ET\n`;
  stream+=`0.68 0.77 0.60 RG 34 52 m ${w-34} 52 l S\nBT /F1 10 Tf 0.4 0.48 0.36 rg ${w/2} 28 Td (${i+1}) Tj ET\n`;
  add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
}
let out="%PDF-1.4\n", offsets=[0];
for(let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
for(const offset of offsets.slice(1)) out+=`${String(offset).padStart(10,"0")} 00000 n \n`;
out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(new URL("reading-sample.pdf",dir),out);
console.log(fileURLToPath(new URL("reading-sample.pdf",dir)));
