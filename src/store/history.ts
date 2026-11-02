import { formatDateTime, formatDuration, formatList } from '../calc/format';
import { csvNumber, toCsv, type CsvColumn } from './csv';

/** Uma cotação salva. Valores em R$ são por peça; o tempo é o da placa inteira. */
export type Quote = {
  id: string;
  /** Data/hora em ISO. */
  savedAt: string;
  fileName: string;
  /** Com `plates`, é a primeira delas. */
  plate: number;
  /** Só quando a cotação soma todas as placas do arquivo como uma peça só. */
  plates?: number[];
  pieces: number;
  gramsPerPiece: number;
  plateSeconds: number | null;
  pricePerKg: number;
  bagPrice: number;
  /** 0 quando a peça não leva argola. */
  ringPrice: number;
  // Adicionais: 0 quando a peça não leva; ausentes nas cotações antigas.
  /** Saquinho. */
  pouchPrice?: number;
  /** Saquinho de chaveiro. */
  keyPouchPrice?: number;
  /** Vela LED. */
  ledPrice?: number;
  /** Valor livre de "Outros". */
  otherPrice?: number;
  /** O que é o "Outros" (ex.: ímã); só quando preenchido. */
  otherNote?: string;
  hourPrice: number;
  profitPct: number;
  filament: number;
  time: number;
  cost: number;
  profit: number;
  price: number;
};

export type NewQuote = Omit<Quote, 'id' | 'savedAt'>;

const KEY = 'custo3d:historico:v1';
/** "Últimas cotações": as mais antigas saem quando passar disso. */
export const HISTORY_LIMIT = 500;

const NUMBER_KEYS = [
  'plate', 'pieces', 'gramsPerPiece', 'pricePerKg', 'bagPrice', 'ringPrice', 'hourPrice',
  'profitPct', 'filament', 'time', 'cost', 'profit', 'price',
] as const satisfies readonly (keyof Quote)[];

const OPTIONAL_NUMBER_KEYS = ['pouchPrice', 'keyPouchPrice', 'ledPrice', 'otherPrice'] as const satisfies readonly (keyof Quote)[];

const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

const isPlateList = (value: unknown) => Array.isArray(value) && value.length >= 2 && value.every(isNumber);

export function isQuote(value: unknown): value is Quote {
  if (typeof value !== 'object' || value == null) return false;
  const q = value as Record<string, unknown>;
  return typeof q.id === 'string'
    && typeof q.savedAt === 'string'
    && typeof q.fileName === 'string'
    && (q.plateSeconds === null || typeof q.plateSeconds === 'number')
    && (q.plates === undefined || isPlateList(q.plates))
    && (q.otherNote === undefined || typeof q.otherNote === 'string')
    && NUMBER_KEYS.every((key) => isNumber(q[key]))
    && OPTIONAL_NUMBER_KEYS.every((key) => q[key] === undefined || isNumber(q[key]));
}

/** "1", ou "1 e 2" / "1, 2 e 3" quando a cotação junta as placas. */
export function plateNumbers(q: Pick<Quote, 'plate' | 'plates'>): string {
  return q.plates ? formatList(q.plates.map(String)) : String(q.plate);
}

/** Mais recentes primeiro. Entradas corrompidas são ignoradas. */
export function loadHistory(): Quote[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(data) ? data.filter(isQuote) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: Quote[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Lê de novo antes de gravar, para não perder o que outra aba salvou. Retorna null se não deu para salvar. */
export function addQuote(entry: NewQuote, now = new Date()): Quote | null {
  const quote: Quote = { ...entry, id: newId(), savedAt: now.toISOString() };
  return saveHistory([quote, ...loadHistory()].slice(0, HISTORY_LIMIT)) ? quote : null;
}

export function removeQuote(id: string): boolean {
  return saveHistory(loadHistory().filter((q) => q.id !== id));
}

/**
 * Junta cotações de um backup. O que já está aqui fica como está; só entra o que falta,
 * e continuam só as últimas HISTORY_LIMIT. Retorna quantas entraram, ou null se não deu para salvar.
 */
export function mergeQuotes(incoming: Quote[]): number | null {
  const current = loadHistory();
  const ids = new Set(current.map((q) => q.id));
  const added = incoming.filter((q) => !ids.has(q.id) && ids.add(q.id));
  if (added.length === 0) return 0;
  // Datas em ISO (UTC): comparar o texto já ordena pela data.
  const merged = [...current, ...added].sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0)).slice(0, HISTORY_LIMIT);
  if (!saveHistory(merged)) return null;
  const kept = new Set(merged.map((q) => q.id));
  return added.filter((q) => kept.has(q.id)).length;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Busca pelo nome do arquivo; todas as palavras precisam aparecer, sem ligar para acento ou maiúscula. */
export function searchQuotes<T extends { fileName: string }>(list: T[], query: string): T[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return list;
  return list.filter((q) => {
    const name = fold(q.fileName);
    return terms.every((t) => name.includes(t));
  });
}

/** Colunas da cotação, sem a data: o CSV dos vendidos usa as mesmas. */
export const QUOTE_CSV_COLUMNS: CsvColumn<Quote>[] = [
  ['Arquivo', (q) => q.fileName],
  ['Placa', plateNumbers],
  ['Peças', (q) => String(q.pieces)],
  ['Gramas por peça', (q) => csvNumber(q.gramsPerPiece)],
  ['Tempo da placa', (q) => (q.plateSeconds == null ? '' : formatDuration(q.plateSeconds))],
  ['Filamento (R$ por kg)', (q) => csvNumber(q.pricePerKg)],
  ['Sacolinha', (q) => csvNumber(q.bagPrice)],
  ['Argola', (q) => csvNumber(q.ringPrice)],
  ['Saquinho', (q) => csvNumber(q.pouchPrice ?? 0)],
  ['Saquinho de chaveiro', (q) => csvNumber(q.keyPouchPrice ?? 0)],
  ['Vela LED', (q) => csvNumber(q.ledPrice ?? 0)],
  ['Outros', (q) => csvNumber(q.otherPrice ?? 0)],
  ['Outros (o que é)', (q) => q.otherNote ?? ''],
  ['Tempo (R$ por hora)', (q) => csvNumber(q.hourPrice)],
  ['Custo do filamento', (q) => csvNumber(q.filament)],
  ['Custo do tempo', (q) => csvNumber(q.time)],
  ['Custo total', (q) => csvNumber(q.cost)],
  ['Lucro (%)', (q) => csvNumber(q.profitPct)],
  ['Lucro', (q) => csvNumber(q.profit)],
  ['Preço de venda', (q) => csvNumber(q.price)],
];

export function historyToCsv(list: Quote[]): string {
  return toCsv([['Data', (q) => formatDateTime(new Date(q.savedAt))], ...QUOTE_CSV_COLUMNS], list);
}
