import { beforeEach, describe, expect, it } from 'vitest';
import { addQuote, removeQuote, type NewQuote, type Quote } from '../src/store/history';
import {
  filterSalesByDate, filterSalesByPaid, loadSales, localDateKey, markSold, removeSale, salesByMonth, salesToCsv, salesTotals,
  setPaid, type PaidFilter,
} from '../src/store/sales';
import { niceMax } from '../src/ui/chart';

const KEY = 'custo3d:vendas:v1';

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

beforeEach(() => localStorage.clear());

describe('itens vendidos', () => {
  it('copia a cotação, começa como não paga e não duplica', () => {
    const q = quote();
    const sale = markSold(q, new Date(2026, 9, 20, 15, 30))!;
    expect(sale).toMatchObject({ fileName: q.fileName, price: 4.97, quoteId: q.id, paid: false, savedAt: q.savedAt });
    expect(sale.id).not.toBe(q.id);
    expect(markSold(q)).toEqual(sale);
    expect(loadSales()).toEqual([sale]);
  });

  it('continua lá depois que a cotação sai do histórico', () => {
    const q = quote();
    markSold(q);
    removeQuote(q.id);
    expect(loadSales()).toHaveLength(1);
  });

  it('marca e desmarca pago, e exclui pelo id', () => {
    const a = markSold(quote({ fileName: 'a' }))!;
    const b = markSold(quote({ fileName: 'b' }))!;
    expect(loadSales().map((s) => s.fileName)).toEqual(['b', 'a']);

    expect(setPaid(a.id, true)).toBe(true);
    expect(loadSales().find((s) => s.id === a.id)!.paid).toBe(true);
    setPaid(a.id, false);
    expect(loadSales().find((s) => s.id === a.id)!.paid).toBe(false);
    expect(setPaid('nao-existe', true)).toBe(false);

    removeSale(b.id);
    expect(loadSales().map((s) => s.fileName)).toEqual(['a']);
  });

  it('ignora dados corrompidos sem quebrar', () => {
    localStorage.setItem(KEY, '{não é json');
    expect(loadSales()).toEqual([]);
    const good = markSold(quote())!;
    localStorage.setItem(KEY, JSON.stringify([good, { ...good, paid: 'sim' }, { ...good, quoteId: undefined }, null]));
    expect(loadSales()).toEqual([good]);
  });

  it('filtra pela data da venda, com os dois extremos inclusos', () => {
    const on = (day: number, hour: number) => markSold(quote({ fileName: `dia-${day}` }), new Date(2026, 9, day, hour, 0))!;
    on(1, 0);
    on(15, 23);
    on(31, 12);
    const list = loadSales();
    const names = (from: string, to: string) => filterSalesByDate(list, from, to).map((s) => s.fileName);

    expect(names('', '')).toEqual(['dia-31', 'dia-15', 'dia-1']);
    expect(names('2026-10-01', '2026-10-15')).toEqual(['dia-15', 'dia-1']);
    expect(names('2026-10-15', '')).toEqual(['dia-31', 'dia-15']);
    expect(names('', '2026-10-14')).toEqual(['dia-1']);
    expect(names('2026-11-01', '')).toEqual([]);
  });

  it('filtra por pagamento: todos, a receber ou pagos', () => {
    const a = markSold(quote({ fileName: 'a' }))!;
    markSold(quote({ fileName: 'b' }));
    setPaid(a.id, true);
    const list = loadSales();
    const names = (filter: PaidFilter) => filterSalesByPaid(list, filter).map((s) => s.fileName);
    expect(names('all')).toEqual(['b', 'a']);
    expect(names('pending')).toEqual(['b']);
    expect(names('paid')).toEqual(['a']);
  });

  it('usa a data do computador, não a de Greenwich', () => {
    // 23:30 no horário local continua sendo o mesmo dia, mesmo que em UTC já seja o seguinte.
    expect(localDateKey(new Date(2026, 9, 20, 23, 30))).toBe('2026-10-20');
    expect(localDateKey(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });

  it('soma total, recebido e a receber sem ruído de ponto flutuante', () => {
    const a = markSold(quote({ fileName: 'a', price: 0.1 }))!;
    markSold(quote({ fileName: 'b', price: 0.2 }));
    markSold(quote({ fileName: 'c', price: 15.46 }));
    setPaid(a.id, true);
    expect(salesTotals(loadSales())).toEqual({ total: 15.76, received: 0.1, pending: 15.66 });
    expect(salesTotals([])).toEqual({ total: 0, received: 0, pending: 0 });
  });

  describe('por mês (Resumo)', () => {
    const NOW = new Date(2026, 9, 21, 9, 0);
    const soldOn = (when: Date, overrides: Partial<NewQuote> = {}) => markSold(quote(overrides), when)!;

    it('traz os últimos meses do mais antigo ao atual, zerando os sem venda', () => {
      soldOn(new Date(2026, 9, 2, 10, 0)); // preço 4,97 · custo 2,487166
      soldOn(new Date(2026, 7, 15, 10, 0), { price: 10, cost: 4 });
      const months = salesByMonth(loadSales(), 6, NOW);
      expect(months.map((m) => m.key)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
      expect(months[5]).toEqual({ key: '2026-10', total: 4.97, profit: 2.48, count: 1 });
      expect(months[3]).toEqual({ key: '2026-08', total: 10, profit: 6, count: 1 });
      expect(months[4]).toEqual({ key: '2026-09', total: 0, profit: 0, count: 0 });
    });

    it('atravessa a virada do ano', () => {
      expect(salesByMonth([], 6, new Date(2027, 1, 10)).map((m) => m.key))
        .toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
    });

    it('usa o mês do computador, não o de Greenwich', () => {
      soldOn(new Date(2026, 9, 31, 23, 30));
      const months = salesByMonth(loadSales(), 2, new Date(2026, 10, 1, 0, 5));
      expect(months.map((m) => [m.key, m.count])).toEqual([['2026-10', 1], ['2026-11', 0]]);
    });

    it('lucro é preço menos custo, somado sem ruído de ponto flutuante', () => {
      soldOn(new Date(2026, 9, 1), { price: 0.1, cost: 0 });
      soldOn(new Date(2026, 9, 2), { price: 0.2, cost: 0 });
      soldOn(new Date(2026, 9, 3), { price: 15.9, cost: 6.18, profit: 9.27 }); // preço arredondado para ,90
      const [october] = salesByMonth(loadSales(), 1, NOW);
      expect(october).toEqual({ key: '2026-10', total: 16.2, profit: 10.02, count: 3 });
    });

    it('deixa de fora vendas antes da janela e depois de hoje', () => {
      soldOn(new Date(2026, 3, 30, 12, 0)); // abril: fora dos últimos 6 meses
      soldOn(new Date(2026, 10, 1, 12, 0)); // novembro: futuro
      const months = salesByMonth(loadSales(), 6, NOW);
      expect(months.reduce((n, m) => n + m.count, 0)).toBe(0);
    });

    it('topo do eixo é redondo e cobre o maior valor', () => {
      expect(niceMax(0)).toBe(4);
      expect(niceMax(5.96)).toBe(8);
      expect(niceMax(10)).toBe(10);
      expect(niceMax(320.4)).toBe(400);
      expect(niceMax(1000)).toBe(1000);
      expect(niceMax(1001)).toBe(2000);
    });
  });

  it('exporta CSV com data da venda e situação do pagamento', () => {
    const sale = markSold(quote({ price: 1234.5 }), new Date(2026, 9, 20, 15, 30))!;
    setPaid(sale.id, true);
    const csv = salesToCsv(loadSales());
    expect(csv.startsWith('﻿Data da venda;Pago;Data da cotação;Arquivo;Placa;')).toBe(true);
    const line = csv.split('\r\n')[1]!;
    expect(line).toBe('20/10/2026 15:30;Sim;18/10/2026 10:00;chaveiro_pikachu.gcode.3mf;1;4;12,15;2h 14min;120,00;0,35;0,40;0,50;1,46;0,28;2,49;100,00;2,49;1234,50');
  });
});
