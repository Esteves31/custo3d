import { isQuote, loadHistory, mergeQuotes, type Quote } from './history';
import { isSale, loadSales, localDateKey, mergeSales, type Sale } from './sales';
import { loadValues, saveValues, toSavedValues, type SavedValues } from './settings';

/** Tudo o que o app guarda, num .json que a pessoa pode levar para outro navegador ou computador. */
export type Backup = {
  app: 'custo3d';
  version: 1;
  /** Data/hora em ISO de quando o backup foi feito. */
  createdAt: string;
  values: SavedValues;
  history: Quote[];
  sales: Sale[];
};

export type RestoreResult = {
  /** Quantas cotações e vendas entraram (as que já estavam aqui não contam). */
  quotes: number;
  sales: number;
  /** Algum campo de "Seus valores" estava vazio e foi preenchido. */
  values: boolean;
};

export class BackupError extends Error {}

export const NOT_A_BACKUP = 'Este arquivo não é um backup do Custo3D. Escolha o arquivo que começa com "custo3d-backup".';
const NEWER_VERSION = 'Este backup foi feito por uma versão mais nova do Custo3D. Atualize o Custo3D e tente de novo.';

const VERSION = 1;
// Quando foi o último backup: guardado à parte, não vai dentro do backup.
const LAST_KEY = 'custo3d:backup:v1';

export function createBackup(now = new Date()): Backup {
  return { app: 'custo3d', version: VERSION, createdAt: now.toISOString(), values: loadValues(), history: loadHistory(), sales: loadSales() };
}

/** Com recuo: dá para abrir no Bloco de Notas e conferir. */
export const backupToJson = (backup: Backup) => JSON.stringify(backup, null, 2);

/** "custo3d-backup-2026-10-22.json" */
export const backupFileName = (date: Date) => `custo3d-backup-${localDateKey(date)}.json`;

/**
 * Lê o texto de um arquivo de backup. Lança BackupError se não for um backup do Custo3D.
 * Cotações e vendas estragadas ficam de fora e são contadas em `skipped`.
 */
export function parseBackup(text: string): { backup: Backup; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BackupError(NOT_A_BACKUP);
  }
  const d = (typeof data === 'object' && data != null ? data : {}) as Record<string, unknown>;
  if (d.app !== 'custo3d' || typeof d.version !== 'number' || !Array.isArray(d.history) || !Array.isArray(d.sales)) {
    throw new BackupError(NOT_A_BACKUP);
  }
  if (d.version > VERSION) throw new BackupError(NEWER_VERSION);

  const history = d.history.filter(isQuote);
  const sales = d.sales.filter(isSale);
  return {
    backup: {
      app: 'custo3d',
      version: VERSION,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
      values: toSavedValues(d.values),
      history,
      sales,
    },
    skipped: d.history.length - history.length + d.sales.length - sales.length,
  };
}

/**
 * Junta o backup com o que já está aqui. Nada é apagado nem trocado: só entra o que falta.
 * Assim, restaurar duas vezes ou restaurar um backup antigo não estraga nada.
 * Retorna null se não deu para salvar (o que já tinha entrado continua salvo).
 */
export function restoreBackup(backup: Backup): RestoreResult | null {
  // Vendas primeiro: são registros de dinheiro.
  const sales = mergeSales(backup.sales);
  if (sales == null) return null;
  const quotes = mergeQuotes(backup.history);
  if (quotes == null) return null;

  const current = loadValues();
  let values = false;
  for (const key of Object.keys(current) as (keyof SavedValues)[]) {
    if (!current[key].trim() && backup.values[key].trim()) {
      current[key] = backup.values[key];
      values = true;
    }
  }
  if (values && !saveValues(current)) return null;

  // O que veio do backup já está guardado num arquivo: conta como backup feito naquela data.
  const createdAt = new Date(backup.createdAt);
  const last = loadLastBackup();
  if (!Number.isNaN(createdAt.getTime()) && (!last || createdAt > last)) markBackupDone(createdAt);

  return { quotes, sales, values };
}

export function loadLastBackup(): Date | null {
  try {
    const date = new Date(localStorage.getItem(LAST_KEY) ?? '');
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export function markBackupDone(date = new Date()): void {
  try {
    localStorage.setItem(LAST_KEY, date.toISOString());
  } catch {
    // sem armazenamento disponível
  }
}
