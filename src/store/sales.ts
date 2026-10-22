import { formatDateTime } from '../calc/format';
import { round2 } from '../calc/number';
import { toCsv } from './csv';
import { isQuote, newId, QUOTE_CSV_COLUMNS, type Quote } from './history';

/**
 * Uma cotação que virou venda. Guarda uma cópia da cotação: excluir a cotação do histórico
 * (ou ela sair pelo limite de 500) não apaga a venda. `id` é o da venda; `quoteId`, o da cotação.
 */
export type Sale = Quote & {
  quoteId: string;
  /** Data/hora em ISO de quando foi marcada como vendida. */
  soldAt: string;
  paid: boolean;
};

export type SalesTotals = { total: number; received: number; pending: number };

/** Filtro de pagamento: todas, só as que faltam receber ou só as pagas. */
export type PaidFilter = 'all' | 'pending' | 'paid';

// Sem limite: são registros de dinheiro, não devem sumir sozinhos.
const KEY = 'custo3d:vendas:v1';

export function isSale(value: unknown): value is Sale {
  if (!isQuote(value)) return false;
  const s = value as Record<string, unknown>;
  return typeof s.quoteId === 'string' && typeof s.soldAt === 'string' && typeof s.paid === 'boolean';
}

/** Mais recentes primeiro. Entradas corrompidas são ignoradas. */
export function loadSales(): Sale[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(data) ? data.filter(isSale) : [];
  } catch {
    return [];
  }
}

function saveSales(list: Sale[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Uma venda por cotação: se já foi vendida, devolve a venda existente. Retorna null se não deu para salvar. */
export function markSold(quote: Quote, now = new Date()): Sale | null {
  const list = loadSales();
  const existing = list.find((s) => s.quoteId === quote.id);
  if (existing) return existing;
  const sale: Sale = { ...quote, id: newId(), quoteId: quote.id, soldAt: now.toISOString(), paid: false };
  return saveSales([sale, ...list]) ? sale : null;
}

export function setPaid(id: string, paid: boolean): boolean {
  const list = loadSales();
  const sale = list.find((s) => s.id === id);
  if (!sale) return false;
  sale.paid = paid;
  return saveSales(list);
}

export function removeSale(id: string): boolean {
  return saveSales(loadSales().filter((s) => s.id !== id));
}

/**
 * Junta vendas de um backup. O que já está aqui fica como está (inclusive o "Pago"); só entra o que falta.
 * Continua valendo uma venda por cotação, para não contar a mesma venda duas vezes.
 * Retorna quantas entraram, ou null se não deu para salvar.
 */
export function mergeSales(incoming: Sale[]): number | null {
  const current = loadSales();
  const ids = new Set(current.map((s) => s.id));
  const quoteIds = new Set(current.map((s) => s.quoteId));
  const added = incoming.filter((s) => {
    if (ids.has(s.id) || quoteIds.has(s.quoteId)) return false;
    ids.add(s.id);
    quoteIds.add(s.quoteId);
    return true;
  });
  if (added.length === 0) return 0;
  // Datas em ISO (UTC): comparar o texto já ordena pela data.
  const merged = [...current, ...added].sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0));
  return saveSales(merged) ? added.length : null;
}

/** "2026-10-20" no fuso do computador, o mesmo formato do <input type="date">. */
export function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Vendas entre `from` e `to` (inclusive, "AAAA-MM-DD"). Data vazia deixa aquele lado aberto. */
export function filterSalesByDate(list: Sale[], from: string, to: string): Sale[] {
  if (!from && !to) return list;
  return list.filter((s) => {
    const day = localDateKey(new Date(s.soldAt));
    return (!from || day >= from) && (!to || day <= to);
  });
}

export function filterSalesByPaid(list: Sale[], filter: PaidFilter): Sale[] {
  if (filter === 'all') return list;
  return list.filter((s) => s.paid === (filter === 'paid'));
}

export function salesTotals(list: Sale[]): SalesTotals {
  let total = 0;
  let received = 0;
  for (const s of list) {
    total += s.price;
    if (s.paid) received += s.price;
  }
  return { total: round2(total), received: round2(received), pending: round2(total - received) };
}

/** Vendas e lucro de um mês. `key` é "AAAA-MM". */
export type MonthSummary = { key: string; total: number; profit: number; count: number };

/** "2026-10" no fuso do computador. */
export function monthKey(date: Date): string {
  return localDateKey(date).slice(0, 7);
}

/** O que sobrou de fato: preço cobrado menos custo. Continua certo com o preço arredondado (,90 ou 0,50). */
export function saleProfit(s: Sale): number {
  return s.price - s.cost;
}

/** Os últimos `months` meses, do mais antigo ao atual. Mês sem venda vem zerado; vendas fora da janela ficam de fora. */
export function salesByMonth(list: Sale[], months: number, now = new Date()): MonthSummary[] {
  const sums = new Map<string, { total: number; profit: number; count: number }>();
  for (let i = months - 1; i >= 0; i--) {
    sums.set(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)), { total: 0, profit: 0, count: 0 });
  }
  for (const s of list) {
    const month = sums.get(monthKey(new Date(s.soldAt)));
    if (!month) continue;
    month.total += s.price;
    month.profit += saleProfit(s);
    month.count++;
  }
  return Array.from(sums, ([key, m]) => ({ key, total: round2(m.total), profit: round2(m.profit), count: m.count }));
}

export function salesToCsv(list: Sale[]): string {
  return toCsv<Sale>([
    ['Data da venda', (s) => formatDateTime(new Date(s.soldAt))],
    ['Pago', (s) => (s.paid ? 'Sim' : 'Não')],
    ['Data da cotação', (s) => formatDateTime(new Date(s.savedAt))],
    ...QUOTE_CSV_COLUMNS,
  ], list);
}
