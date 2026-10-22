import { formatDuration, formatGrams } from '../calc/format';
import type { Quote } from '../store/history';
import { localDateKey } from '../store/sales';
import { h } from './dom';

/** Partes comuns às listas do Histórico e dos Itens vendidos. */

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Placa 1 · 4 peças · 12,15 g por peça · 2h 14min · com argola" */
export function quoteDetails(q: Quote): string {
  const parts = [
    `Placa ${q.plate}`,
    plural(q.pieces, 'peça', 'peças'),
    `${formatGrams(q.gramsPerPiece)} por peça`,
    q.plateSeconds != null && formatDuration(q.plateSeconds),
    q.ringPrice > 0 && 'com argola',
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Baixa um texto como arquivo; o navegador salva na pasta de downloads. */
export function downloadFile(content: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = h('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Baixa o CSV como "custo3d-<nome>-2026-10-20.csv". */
export function downloadCsv(csv: string, name: string): void {
  downloadFile(csv, `custo3d-${name}-${localDateKey(new Date())}.csv`, 'text/csv;charset=utf-8');
}
