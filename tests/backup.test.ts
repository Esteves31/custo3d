import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackupError, backupFileName, backupToJson, createBackup, loadLastBackup, markBackupDone, parseBackup, restoreBackup,
} from '../src/store/backup';
import { addQuote, HISTORY_LIMIT, loadHistory, type NewQuote, type Quote } from '../src/store/history';
import { loadSales, markSold, removeSale, setPaid } from '../src/store/sales';
import { loadValues, saveValues } from '../src/store/settings';
import { backupStatus, restoredText } from '../src/ui/backupCard';

const quote = (overrides: Partial<NewQuote> = {}, when = new Date(2026, 9, 18, 10, 0)): Quote =>
  addQuote({
    fileName: 'chaveiro_pikachu.gcode.3mf',
    plate: 1,
    pieces: 4,
    gramsPerPiece: 12.15,
    plateSeconds: 8040,
    pricePerKg: 120,
    bagPrice: 0.35,
    ringPrice: 0.4,
    hourPrice: 0.5,
    profitPct: 100,
    filament: 1.458,
    time: 0.279166,
    cost: 2.487166,
    profit: 2.487166,
    price: 4.97,
    ...overrides,
  }, when)!;

const VALUES = { kg: '120,00', bag: '0,35', ring: '0,40', hour: '0,50', profit: '100' };

/** Dados de exemplo: 2 cotações, 1 vendida e paga. */
function seed() {
  saveValues(VALUES);
  const a = quote({ fileName: 'a.gcode.3mf' }, new Date(2026, 9, 18, 10, 0));
  const b = quote({ fileName: 'b.gcode.3mf' }, new Date(2026, 9, 19, 10, 0));
  const sale = markSold(a, new Date(2026, 9, 20, 15, 0))!;
  setPaid(sale.id, true);
  return { a, b, sale: loadSales()[0]! };
}

/** Faz o backup, passa pelo texto do arquivo e lê de volta, como o app faz. */
const roundTrip = () => parseBackup(backupToJson(createBackup(new Date(2026, 9, 21, 9, 0))));

beforeEach(() => localStorage.clear());

describe('backup', () => {
  it('guarda tudo e restaura igual num navegador vazio', () => {
    const { a, b, sale } = seed();
    const { backup, skipped } = roundTrip();
    expect(skipped).toBe(0);

    localStorage.clear();
    expect(restoreBackup(backup)).toEqual({ quotes: 2, sales: 1, values: true });
    expect(loadHistory()).toEqual([b, a]);
    expect(loadSales()).toEqual([sale]);
    expect(loadValues()).toEqual(VALUES);
  });

  it('restaurar de novo não duplica nada', () => {
    seed();
    const { backup } = roundTrip();
    expect(restoreBackup(backup)).toEqual({ quotes: 0, sales: 0, values: false });
    expect(loadHistory()).toHaveLength(2);
    expect(loadSales()).toHaveLength(1);
  });

  it('não troca o que já está aqui: um backup antigo não desfaz o "Pago"', () => {
    const { a } = seed();
    const sale = loadSales()[0]!;
    setPaid(sale.id, false);
    const { backup } = roundTrip();
    setPaid(sale.id, true);
    saveValues({ ...VALUES, kg: '150,00', ring: '' });

    expect(restoreBackup(backup)).toEqual({ quotes: 0, sales: 0, values: true });
    expect(loadSales()[0]!.paid).toBe(true);
    // Só o campo vazio foi preenchido.
    expect(loadValues()).toEqual({ ...VALUES, kg: '150,00' });
    expect(loadHistory().map((q) => q.id)).toContain(a.id);
  });

  it('traz de volta uma venda excluída, sem contar duas vezes a mesma cotação', () => {
    const { a, sale } = seed();
    const { backup } = roundTrip();

    removeSale(sale.id);
    expect(restoreBackup(backup)!.sales).toBe(1);
    expect(loadSales()).toEqual([sale]);

    // Vendida de novo depois do backup: é outra venda da mesma cotação, e a do backup fica de fora.
    removeSale(sale.id);
    const again = markSold(a)!;
    expect(restoreBackup(backup)!.sales).toBe(0);
    expect(loadSales()).toEqual([again]);
  });

  it('junta vendas na ordem da data', () => {
    const { sale } = seed();
    const { backup } = roundTrip();
    localStorage.clear();
    const newer = markSold(quote({ fileName: 'novo' }), new Date(2026, 9, 25, 10, 0))!;
    const older = markSold(quote({ fileName: 'velho' }), new Date(2026, 9, 1, 10, 0))!;

    restoreBackup(backup);
    expect(loadSales().map((s) => s.id)).toEqual([newer.id, sale.id, older.id]);
  });

  it(`continua guardando só as últimas ${HISTORY_LIMIT} cotações`, () => {
    const old = { ...quote({ fileName: 'antiga' }, new Date(2025, 0, 1)), id: 'antiga' };
    const recent = { ...quote({ fileName: 'recente' }, new Date(2026, 9, 21)), id: 'recente' };
    localStorage.clear();
    for (let i = 0; i < HISTORY_LIMIT; i++) quote({ fileName: `nova-${i}` }, new Date(2026, 9, 20, 10, 0, i));
    const { backup } = roundTrip();
    backup.history = [recent, old];

    // A antiga não cabe; a recente entra no lugar da mais antiga que estava aqui.
    expect(restoreBackup(backup)!.quotes).toBe(1);
    const list = loadHistory();
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0]!.id).toBe('recente');
    expect(list.some((q) => q.id === 'antiga')).toBe(false);
  });

  it('recusa arquivos que não são backup', () => {
    expect(() => parseBackup('{não é json')).toThrow(BackupError);
    expect(() => parseBackup('[]')).toThrow(BackupError);
    expect(() => parseBackup('null')).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ app: 'outro', version: 1, history: [], sales: [] }))).toThrow(/não é um backup/);
    expect(() => parseBackup(JSON.stringify({ app: 'custo3d', version: 2, history: [], sales: [] }))).toThrow(/versão mais nova/);
  });

  it('deixa de fora os registros estragados e conta quantos', () => {
    const { a, sale } = seed();
    const data = JSON.parse(backupToJson(createBackup()));
    data.history.push({ id: 'x', price: 'abc' }, null);
    data.sales.push({ ...sale, paid: 'sim' });
    data.values = { kg: 99, bag: '0,35' };

    const { backup, skipped } = parseBackup(`﻿${JSON.stringify(data)}`);
    expect(skipped).toBe(3);
    expect(backup.history.map((q) => q.id)).toContain(a.id);
    expect(backup.sales).toHaveLength(1);
    expect(backup.values).toEqual({ kg: '', bag: '0,35', ring: '', hour: '', profit: '' });
  });

  it('nome do arquivo com a data', () => {
    expect(backupFileName(new Date(2026, 9, 2, 23, 59))).toBe('custo3d-backup-2026-10-02.json');
  });

  it('restaurar conta como backup feito na data do arquivo, se for mais novo', () => {
    seed();
    const { backup } = roundTrip();
    localStorage.clear();
    restoreBackup(backup);
    expect(loadLastBackup()).toEqual(new Date(2026, 9, 21, 9, 0));

    markBackupDone(new Date(2026, 9, 30));
    restoreBackup(backup);
    expect(loadLastBackup()).toEqual(new Date(2026, 9, 30));
  });
});

describe('aviso de backup', () => {
  const now = new Date(2026, 9, 22, 10, 0);
  const salesOn = (...days: number[]) => {
    for (const day of days) markSold(quote({ fileName: `d${day}` }), new Date(2026, 9, day, 12, 0));
    return loadSales();
  };

  it('sem backup: só avisa quando já há vendas', () => {
    expect(backupStatus(null, [], now)).toEqual({ warn: false, text: 'Nenhum backup feito ainda.' });
    expect(backupStatus(null, salesOn(20), now).warn).toBe(true);
  });

  it('conta as vendas novas e só avisa depois de 30 dias', () => {
    const sales = salesOn(1, 20, 21);
    expect(backupStatus(new Date(2026, 9, 22, 8, 0), sales, now))
      .toEqual({ warn: false, text: 'Último backup: 22/10/2026 08:00 (hoje). Nenhuma venda nova desde então.' });
    expect(backupStatus(new Date(2026, 9, 21, 8, 0), sales, now).text)
      .toBe('Último backup: 21/10/2026 08:00 (ontem). 1 venda nova desde então.');
    expect(backupStatus(new Date(2026, 8, 30), sales, now))
      .toEqual({ warn: false, text: 'Último backup: 30/09/2026 00:00 (há 22 dias). 3 vendas novas desde então.' });
    expect(backupStatus(new Date(2026, 8, 1), sales, now))
      .toEqual({ warn: true, text: 'Último backup: 01/09/2026 00:00 (há 51 dias). 3 vendas novas desde então. Faça um backup novo.' });
    // Velho, mas sem nada novo: não precisa de outro.
    expect(backupStatus(new Date(2026, 9, 21, 13, 0), sales, new Date(2026, 11, 31)).warn).toBe(false);
  });

  it('mensagem depois de restaurar', () => {
    expect(restoredText({ quotes: 2, sales: 1, values: true }, 0))
      .toBe('Backup restaurado. Vendas adicionadas: 1. Cotações adicionadas: 2. Os campos vazios de "Seus valores" foram preenchidos.');
    expect(restoredText({ quotes: 0, sales: 0, values: false }, 1))
      .toBe('Nada novo para restaurar: tudo o que está nesse backup já estava aqui. 1 registro estragado ficou de fora.');
  });
});
