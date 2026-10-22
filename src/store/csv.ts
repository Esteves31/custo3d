import { round2 } from '../calc/number';

export type CsvColumn<T> = [header: string, value: (row: T) => string];

/** Sem separador de milhar: o Excel em pt-BR lê "1234,50" como número. */
export const csvNumber = (value: number, digits = 2) =>
  round2(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });

/** Escapa para CSV e impede que um texto começando com = vire fórmula no Excel. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV para o Excel em pt-BR: ";" como separador, vírgula decimal e BOM para os acentos. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map(([header]) => header), ...rows.map((row) => columns.map(([, value]) => value(row)))];
  return '﻿' + lines.map((line) => line.map(cell).join(';')).join('\r\n') + '\r\n';
}
