// Gera o pacote para enviar ao colega: dist/custo3d-AAAA-MM-DD-HHMM.zip com o HTML e o LEIA-ME.
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const FILES = ['custo3d.html', 'LEIA-ME.txt'];

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const out = `dist/custo3d-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;

const zip = new JSZip();
for (const name of FILES) zip.file(name, readFileSync(`dist/${name}`));
writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

console.log(`Pacote pronto: ${out}`);
