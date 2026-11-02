import { beforeEach, describe, expect, it } from 'vitest';
import { addQuote, HISTORY_LIMIT, historyToCsv, isQuote, loadHistory, removeQuote, searchQuotes, type NewQuote } from '../src/store/history';
import { quoteDetails } from '../src/ui/listParts';

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

  it('guarda as placas juntas e recusa uma lista de placas estragada', () => {
    const quote = addQuote(sample({ plates: [1, 2] }))!;
    expect(loadHistory()[0]!.plates).toEqual([1, 2]);
    expect(isQuote({ ...quote, plates: [1] })).toBe(false);
    expect(isQuote({ ...quote, plates: ['1', '2'] })).toBe(false);
    expect(isQuote({ ...quote, plates: undefined })).toBe(true);
  });

  it('recusa adicionais estragados', () => {
    const quote = addQuote(sample({ pouchPrice: 0.2, otherNote: 'ímã' }))!;
    expect(isQuote(quote)).toBe(true);
    expect(isQuote({ ...quote, otherPrice: 'x' })).toBe(false);
    expect(isQuote({ ...quote, ledPrice: Infinity })).toBe(false);
    expect(isQuote({ ...quote, otherNote: 3 })).toBe(false);
  });

  it('lista os adicionais no detalhe da cotação', () => {
    const q = addQuote(sample({ ringPrice: 0, pouchPrice: 0.2, ledPrice: 3, otherPrice: 1, otherNote: 'ímã' }))!;
    expect(quoteDetails(q)).toBe('Placa 1 · 4 peças · 12,15 g por peça · 2h 14min · com saquinho, vela LED e ímã');
    const semNome = addQuote(sample({ otherPrice: 1 }))!;
    expect(quoteDetails(semNome)).toBe('Placa 1 · 4 peças · 12,15 g por peça · 2h 14min · com argola e outros');
  });

  it('mostra "Placas 1 e 2" no detalhe da cotação de placas juntas', () => {
    const one = addQuote(sample())!;
    const all = addQuote(sample({ plates: [1, 2, 3], pieces: 1, ringPrice: 0 }))!;
    expect(quoteDetails(one)).toBe('Placa 1 · 4 peças · 12,15 g por peça · 2h 14min · com argola');
    expect(quoteDetails(all)).toBe('Placas 1, 2 e 3 · 1 peça · 12,15 g por peça · 2h 14min');
  });
});

describe('historyToCsv', () => {
  it('usa ; e vírgula decimal, com BOM para o Excel', () => {
    addQuote(sample({ fileName: 'chaveiro; "fofo"', price: 1234.5 }), new Date(2026, 9, 20, 8, 7));
    const csv = historyToCsv(loadHistory());
    expect(csv.startsWith('﻿Data;Arquivo;Placa;Peças;')).toBe(true);
    const [, line] = csv.slice(1).split('\r\n');
    // Cotação sem os adicionais novos (como as antigas): saem zerados.
    expect(line).toBe('20/10/2026 08:07;"chaveiro; ""fofo""";1;4;12,15;2h 14min;120,00;0,35;0,40;0,00;0,00;0,00;0,00;;0,50;1,46;0,28;2,49;100,00;2,49;1234,50');
  });

  it('escreve os adicionais e o que é o "Outros"', () => {
    addQuote(sample({ pouchPrice: 0.2, keyPouchPrice: 0.15, ledPrice: 3, otherPrice: 1, otherNote: 'ímã' }));
    const [head, line] = historyToCsv(loadHistory()).slice(1).split('\r\n');
    expect(head).toContain(';Argola;Saquinho;Saquinho de chaveiro;Vela LED;Outros;Outros (o que é);');
    expect(line!.split(';').slice(9, 14)).toEqual(['0,20', '0,15', '3,00', '1,00', 'ímã']);
  });

  it('escreve "1 e 2" na coluna Placa quando a cotação junta as placas', () => {
    addQuote(sample({ plates: [1, 2] }));
    const line = historyToCsv(loadHistory()).split('\r\n')[1]!;
    expect(line.split(';')[2]).toBe('1 e 2');
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
