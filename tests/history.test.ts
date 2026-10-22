import { beforeEach, describe, expect, it } from 'vitest';
import { addQuote, HISTORY_LIMIT, historyToCsv, loadHistory, removeQuote, searchQuotes, type NewQuote } from '../src/store/history';

const KEY = 'custo3d:historico:v1';

const sample = (overrides: Partial<NewQuote> = {}): NewQuote => ({
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
});

beforeEach(() => localStorage.clear());

describe('histórico de cotações', () => {
  it('salva a mais recente primeiro e volta igual', () => {
    addQuote(sample({ fileName: 'a.gcode.3mf' }), new Date(2026, 9, 20, 8, 0));
    const second = addQuote(sample({ fileName: 'b.gcode.3mf' }), new Date(2026, 9, 20, 9, 0));
    const list = loadHistory();
    expect(list.map((q) => q.fileName)).toEqual(['b.gcode.3mf', 'a.gcode.3mf']);
    expect(list[0]).toEqual(second);
  });

  it('exclui pelo id', () => {
    const a = addQuote(sample({ fileName: 'a' }))!;
    addQuote(sample({ fileName: 'b' }));
    expect(removeQuote(a.id)).toBe(true);
    expect(loadHistory().map((q) => q.fileName)).toEqual(['b']);
  });

  it(`guarda só as últimas ${HISTORY_LIMIT}`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) addQuote(sample({ fileName: `peca-${i}` }));
    const list = loadHistory();
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0]!.fileName).toBe(`peca-${HISTORY_LIMIT + 2}`);
    expect(list.at(-1)!.fileName).toBe('peca-3');
  });

  it('ignora dados corrompidos sem quebrar', () => {
    localStorage.setItem(KEY, '{não é json');
    expect(loadHistory()).toEqual([]);
    const good = addQuote(sample())!;
    localStorage.setItem(KEY, JSON.stringify([good, { id: 'x', price: 'abc' }, null, 42]));
    expect(loadHistory()).toEqual([good]);
  });

  it('busca pelo nome sem ligar para acento ou maiúscula', () => {
    addQuote(sample({ fileName: 'Porta-copos Jolteon.gcode.3mf' }));
    addQuote(sample({ fileName: 'Chaveiro Coração.gcode.3mf' }));
    const list = loadHistory();
    expect(searchQuotes(list, 'coracao').map((q) => q.fileName)).toEqual(['Chaveiro Coração.gcode.3mf']);
    expect(searchQuotes(list, 'JOLTEON copos')).toHaveLength(1);
    expect(searchQuotes(list, '   ')).toHaveLength(2);
    expect(searchQuotes(list, 'dragão')).toHaveLength(0);
  });
});

describe('historyToCsv', () => {
  it('usa ; e vírgula decimal, com BOM para o Excel', () => {
    addQuote(sample({ fileName: 'chaveiro; "fofo"', price: 1234.5 }), new Date(2026, 9, 20, 8, 7));
    const csv = historyToCsv(loadHistory());
    expect(csv.startsWith('﻿Data;Arquivo;Placa;Peças;')).toBe(true);
    const [, line] = csv.slice(1).split('\r\n');
    expect(line).toBe('20/10/2026 08:07;"chaveiro; ""fofo""";1;4;12,15;2h 14min;120,00;0,35;0,40;0,50;1,46;0,28;2,49;100,00;2,49;1234,50');
  });

  it('deixa o tempo vazio quando o arquivo não informa', () => {
    addQuote(sample({ plateSeconds: null }));
    const line = historyToCsv(loadHistory()).split('\r\n')[1]!;
    expect(line.split(';')[5]).toBe('');
  });

  it('não deixa nome de arquivo virar fórmula', () => {
    addQuote(sample({ fileName: '=HYPERLINK("x")' }));
    const line = historyToCsv(loadHistory()).split('\r\n')[1]!;
    expect(line).toContain(`;"'=HYPERLINK(""x"")";`);
  });
});
