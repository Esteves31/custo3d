import { roundCents } from './price';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 15,46" com espaço comum (o Intl usa espaço não separável, que atrapalha ao colar). */
export function formatBRL(value: number): string {
  return brl.format(roundCents(value)).replace(/\s/g, ' ');
}

export function formatDecimal(value: number, digits: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Número como a pessoa digitaria: 120 → "120,00" (money) ou 150 → "150" (percent). */
export function formatInput(value: number, kind: 'money' | 'percent' | 'integer'): string {
  if (kind === 'money') return formatDecimal(value, 2);
  if (kind === 'integer') return String(Math.round(value));
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });
}

/** Até 2 casas, como o Bambu Studio mostra: 48,6 g · 18,05 g · 13,16 g. */
export function formatGrams(grams: number): string {
  return `${grams.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} g`;
}

/** "20/10/2026 08:07", sem a vírgula do Intl, para o Excel reconhecer como data. */
export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Nome do mês de "AAAA-MM": "outubro". */
export function monthName(key: string): string {
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? '';
}

/** "2026-10" → "out/26" (short) ou "outubro de 2026" (long). Lista própria: o Intl põe ponto em "out.". */
export function formatMonth(key: string, style: 'short' | 'long'): string {
  const year = key.slice(0, 4);
  const name = monthName(key);
  return style === 'short' ? `${name.slice(0, 3)}/${year.slice(2)}` : `${name} de ${year}`;
}

const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

/** Para os eixos dos gráficos: "R$ 0" · "R$ 150" · "R$ 1,5 mil". */
export function formatBRLCompact(value: number): string {
  return brlCompact.format(value).replace(/\s/g, ' ');
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/**
 * Trunca como o Bambu Studio (nunca arredonda para cima), para bater com o que ele mostra:
 * 3333 → "55min 33s" · 7716 → "2h 08min" · 2700 → "45min" · null → "—"
 */
export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}min`;
  if (m > 0) return s > 0 ? `${m}min ${pad(s)}s` : `${m}min`;
  return `${s}s`;
}
