import { describe, expect, it } from 'vitest';
import { colorName, normalizeHex } from '../src/calc/color';
import {
  formatBRL, formatBRLCompact, formatDuration, formatGrams, formatInput, formatMonth, formatPercent, monthName,
} from '../src/calc/format';
import { parseNumber } from '../src/calc/number';
import { applyRounding, computePrice, roundCents, type Rounding } from '../src/calc/price';
import { validateField } from '../src/calc/validate';

describe('computePrice — casos obrigatórios do plano', () => {
  it.each<[number, number, number, number, number, Rounding, string, string]>([
    [48.6, 1, 120, 0.35, 150, 'none', 'R$ 6,18', 'R$ 15,46'],
    [48.6, 1, 120, 0.35, 150, '90', 'R$ 6,18', 'R$ 15,90'],
    [48.6, 1, 120, 0.35, 150, '50', 'R$ 6,18', 'R$ 15,50'],
    [48.6, 4, 120, 0.35, 100, 'none', 'R$ 1,81', 'R$ 3,62'],
    [22.1, 1, 0, 0, 0, 'none', 'R$ 0,00', 'R$ 0,00'],
  ])('%s g / %s peça(s), R$ %s/kg, sacolinha %s, %s%%, arred. %s', (g, pieces, kg, bag, pct, rounding, cost, price) => {
    const r = computePrice({ plateGrams: g, pieces, pricePerKg: kg, bagPrice: bag, profitPct: pct, rounding });
    expect(formatBRL(r.cost)).toBe(cost);
    expect(formatBRL(r.price)).toBe(price);
  });

  it('detalha filamento, sacolinha e lucro', () => {
    const r = computePrice({ plateGrams: 48.6, pieces: 4, pricePerKg: 120, bagPrice: 0.35, profitPct: 100, rounding: 'none' });
    expect(r.gramsPerPiece).toBeCloseTo(12.15);
    expect(roundCents(r.filament)).toBe(1.46);
    expect(r.bag).toBe(0.35);
    expect(r.energy).toBe(0);
    expect(roundCents(r.profit)).toBe(1.81);
  });

  it('inclui energia por peça quando ativada', () => {
    // 150 W × 2 h = 0,3 kWh × R$ 1,00 = R$ 0,30 por placa → R$ 0,15 por peça.
    const r = computePrice({
      plateGrams: 0, pieces: 2, pricePerKg: 0, bagPrice: 0, profitPct: 0, rounding: 'none',
      plateSeconds: 7200, energy: { watts: 150, kwhPrice: 1 },
    });
    expect(roundCents(r.energy)).toBe(0.15);
    expect(r.price).toBe(0.15);
  });

  it('soma argola por peça e o tempo da placa dividido entre as peças', () => {
    // 8040 s = 2,2333 h × R$ 0,50 = R$ 1,1167 por placa.
    const base = { plateGrams: 48.6, pricePerKg: 120, bagPrice: 0.35, ringPrice: 0.4, hourPrice: 0.5, plateSeconds: 8040, rounding: 'none' as const };

    const one = computePrice({ ...base, pieces: 1, profitPct: 150 });
    expect(roundCents(one.ring)).toBe(0.4);
    expect(roundCents(one.time)).toBe(1.12);
    expect(formatBRL(one.cost)).toBe('R$ 7,70'); // 5,832 + 0,35 + 0,40 + 1,1167
    expect(formatBRL(one.price)).toBe('R$ 19,25');

    const four = computePrice({ ...base, pieces: 4, profitPct: 100 });
    expect(roundCents(four.ring)).toBe(0.4); // argola é por peça, não divide
    expect(roundCents(four.time)).toBe(0.28);
    expect(formatBRL(four.cost)).toBe('R$ 2,49'); // 1,458 + 0,35 + 0,40 + 0,2792
    expect(formatBRL(four.price)).toBe('R$ 4,97');
  });

  it('sem tempo no arquivo, o preço da hora não soma nada', () => {
    const r = computePrice({ plateGrams: 0, pieces: 1, pricePerKg: 0, bagPrice: 0, hourPrice: 0.5, plateSeconds: null, profitPct: 0, rounding: 'none' });
    expect(r.time).toBe(0);
    expect(r.ring).toBe(0);
    expect(r.price).toBe(0);
  });

  it('ignora energia sem tempo de impressão e trata peças < 1 como 1', () => {
    const r = computePrice({
      plateGrams: 100, pieces: 0, pricePerKg: 100, bagPrice: 0, profitPct: 0, rounding: 'none',
      plateSeconds: null, energy: { watts: 150, kwhPrice: 1 },
    });
    expect(r.energy).toBe(0);
    expect(r.price).toBe(10);
  });
});

describe('roundCents', () => {
  // 2.135 e 4.015 quebram a versão `Math.round((x + Number.EPSILON) * 100) / 100`.
  it.each([
    [15.455, 15.46],
    [1.005, 1.01],
    [2.135, 2.14],
    [4.015, 4.02],
    [1.004, 1],
    [0, 0],
  ])('%s → %s', (input, expected) => {
    expect(roundCents(input)).toBe(expected);
  });

  it('arredonda meio centavo para cima de 0 a R$ 20.000', () => {
    for (let c = 0; c < 2_000_000; c += 7) {
      expect(roundCents((c + 0.5) / 100)).toBe((c + 1) / 100);
    }
  });
});

describe('applyRounding', () => {
  it.each<[number, Rounding, number]>([
    [15.455, '90', 15.9],
    [15.9, '90', 15.9],
    [15.91, '90', 16.9],
    [0.5, '90', 0.9],
    [15.01, '50', 15.5],
    [15.5, '50', 15.5],
    [15.51, '50', 16],
    [15, '50', 15],
    [0, '90', 0],
    [0, '50', 0],
  ])('%s com %s → %s', (price, rounding, expected) => {
    expect(applyRounding(price, rounding)).toBe(expected);
  });
});

describe('parseNumber', () => {
  it.each([
    ['120,00', 120],
    ['120.5', 120.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['0,35', 0.35],
    [',5', 0.5],
    ['120,', 120],
    ['150', 150],
    ['150%', 150],
    ['R$ 12,90', 12.9],
    ['  7 ', 7],
    ['1.234.567', 1234567],
    ['-5', -5],
  ])('"%s" → %s', (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '12a', '1,2,3', '1.2.3', '12.34,5', '1e5', '1,234,56', 'R$'])('"%s" é inválido', (input) => {
    expect(parseNumber(input)).toBeNull();
  });
});

describe('formatação', () => {
  it('moeda em pt-BR com espaço comum', () => {
    expect(formatBRL(15.455)).toBe('R$ 15,46');
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
  });
  it('gramas, percentual e entrada', () => {
    expect(formatGrams(48.6)).toBe('48,6 g');
    expect(formatGrams(18.049999999999997)).toBe('18,05 g'); // soma real de 4 filamentos
    expect(formatGrams(13.16)).toBe('13,16 g');
    expect(formatGrams(20)).toBe('20,0 g');
    expect(formatPercent(150)).toBe('150%');
    expect(formatPercent(12.5)).toBe('12,5%');
    expect(formatInput(120, 'money')).toBe('120,00');
    expect(formatInput(1234.5, 'money')).toBe('1.234,50');
    expect(formatInput(12.5, 'percent')).toBe('12,5');
    expect(formatInput(4, 'integer')).toBe('4');
  });
  it.each([
    [8040, '2h 14min'],
    [3900, '1h 05min'],
    [2700, '45min'],
    [3333, '55min 33s'], // G-code real: "total estimated time: 55m 33s"
    [2703, '45min 03s'],
    [7716, '2h 08min'], // 2h 8m 36s: trunca, não arredonda
    [20, '20s'],
    [null, '—'],
  ])('tempo %s → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
  it('mês curto para o eixo e longo para o texto, sem o ponto do Intl', () => {
    expect(formatMonth('2026-10', 'short')).toBe('out/26');
    expect(formatMonth('2026-10', 'long')).toBe('outubro de 2026');
    expect(formatMonth('2027-01', 'short')).toBe('jan/27');
    expect(formatMonth('2026-12', 'long')).toBe('dezembro de 2026');
    expect(formatMonth('2026-03', 'short')).toBe('mar/26');
    expect(monthName('2026-03')).toBe('março');
  });
  it('moeda compacta para os eixos', () => {
    expect(formatBRLCompact(0)).toBe('R$ 0');
    expect(formatBRLCompact(150)).toBe('R$ 150');
    expect(formatBRLCompact(2.5)).toBe('R$ 2,5');
    expect(formatBRLCompact(1000)).toBe('R$ 1 mil');
    expect(formatBRLCompact(1500)).toBe('R$ 1,5 mil');
  });
});

describe('cores', () => {
  it.each([
    ['#000000FF', '#000000'],
    ['#fff', '#FFFFFF'],
    ['c12e1f', '#C12E1F'],
    ['', ''],
    ['azul', ''],
  ])('normalizeHex(%s) → %s', (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
  });

  it.each([
    ['#000000', 'Preto'],
    ['#FFFFFF', 'Branco'],
    ['#F3F4F6', 'Branco'],
    ['#1F2937', 'Grafite'],
    ['#3B3B3B', 'Grafite'],
    ['#5A5A5A', 'Cinza-escuro'],
    // Cores reais do G-code do colega (Bambu PLA Matte/Basic):
    ['#E5B03D', 'Dourado'],
    ['#4D3324', 'Marrom-escuro'],
    ['#C12E1F', 'Vermelho'],
    ['#1565C0', 'Azul'],
    ['#FFEB3B', 'Amarelo'],
    ['inválida', ''],
  ])('colorName(%s) → %s', (input, expected) => {
    expect(colorName(input)).toBe(expected);
  });
});

describe('validateField', () => {
  it('aceita valores válidos', () => {
    expect(validateField('120,00', 'money')).toEqual({ status: 'ok', value: 120 });
    expect(validateField('150', 'percent')).toEqual({ status: 'ok', value: 150 });
    expect(validateField('4', 'integer')).toEqual({ status: 'ok', value: 4 });
    expect(validateField('0', 'money')).toEqual({ status: 'ok', value: 0 });
  });
  it('separa vazio de inválido', () => {
    expect(validateField('  ', 'money')).toEqual({ status: 'empty' });
    expect(validateField('abc', 'money')).toMatchObject({ status: 'invalid' });
    expect(validateField('-1', 'money')).toMatchObject({ status: 'invalid', message: 'O valor não pode ser negativo.' });
  });
  it('peças precisam ser inteiras a partir de 1', () => {
    expect(validateField('0', 'integer')).toMatchObject({ status: 'invalid' });
    expect(validateField('2,5', 'integer')).toMatchObject({ status: 'invalid' });
  });
});
