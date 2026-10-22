import { formatBRL, formatBRLCompact, formatMonth } from '../calc/format';
import type { MonthSummary } from '../store/sales';
import { h } from './dom';
import { plural } from './listParts';

const TICKS = 4;

/**
 * Topo do eixo: o menor passo "redondo" (1, 2, 2,5 ou 5 × 10ⁿ) que, vezes 4 linhas, cobre o maior valor.
 * Passo mínimo de R$ 1, para os rótulos nunca terem centavos picados.
 */
export function niceMax(max: number): number {
  const raw = Math.max(max / TICKS, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw - 1e-9)!;
  return step * TICKS;
}

/** "outubro de 2026 · 3 vendas · Vendido R$ 320,40 · Lucro R$ 160,20" */
function monthText(m: MonthSummary): string {
  return [
    formatMonth(m.key, 'long'),
    plural(m.count, 'venda', 'vendas'),
    `Vendido ${formatBRL(m.total)}`,
    `Lucro ${formatBRL(m.profit)}`,
  ].join(' · ');
}

/** Altura da barra em % do eixo. Valor positivo pequeno ganha 2px para não sumir. */
function bar(series: 'sales' | 'profit', value: number, top: number): HTMLElement {
  const pct = Math.max(0, Math.min(100, (value / top) * 100));
  const height = value > 0 ? `max(2px, ${pct.toFixed(2)}%)` : '0';
  return h('span', { class: `chart-bar chart-bar-${series}`, style: `height: ${height}` });
}

function key(series: 'sales' | 'profit', label: string): HTMLElement {
  return h('span', { class: 'chart-key' }, h('span', { class: `chart-swatch chart-bar-${series}`, 'aria-hidden': 'true' }), label);
}

function table(data: MonthSummary[]): HTMLElement {
  return h('details', { class: 'chart-table' },
    h('summary', null, 'Ver em tabela'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data-table' },
        h('caption', { class: 'sr-only' }, 'Vendas e lucro por mês'),
        h('thead', null,
          h('tr', null,
            h('th', { scope: 'col' }, 'Mês'),
            h('th', { scope: 'col', class: 'num' }, 'Vendas'),
            h('th', { scope: 'col', class: 'num' }, 'Vendido'),
            h('th', { scope: 'col', class: 'num' }, 'Lucro'),
          ),
        ),
        h('tbody', null, ...data.map((m) =>
          h('tr', null,
            h('th', { scope: 'row' }, formatMonth(m.key, 'long')),
            h('td', { class: 'num' }, String(m.count)),
            h('td', { class: 'num' }, formatBRL(m.total)),
            h('td', { class: 'num' }, formatBRL(m.profit)),
          ))),
      ),
    ),
  );
}

/** Colunas de Vendido e Lucro lado a lado, um par por mês, no mesmo eixo em R$. Feito em HTML/CSS, sem biblioteca. */
export function monthColumns(data: MonthSummary[]): HTMLElement {
  const top = niceMax(Math.max(0, ...data.map((m) => Math.max(m.total, m.profit))));
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (top / TICKS) * i);
  const empty = data.every((m) => m.count === 0);

  return h('div', { class: 'chart' },
    h('div', { class: 'chart-legend' }, key('sales', 'Vendido'), key('profit', 'Lucro')),
    empty && h('p', { class: 'muted small' }, `Nenhuma venda nos últimos ${data.length} meses.`),
    h('div', { class: 'chart-plot' },
      h('div', { class: 'chart-axis', 'aria-hidden': 'true' },
        ...ticks.map((t) => h('span', { class: 'chart-tick', style: `bottom: ${(t / top) * 100}%` }, formatBRLCompact(t)))),
      h('div', { class: 'chart-area' },
        h('div', { class: 'chart-grid', 'aria-hidden': 'true' },
          ...ticks.map((t) => h('span', { class: t === 0 ? 'chart-line chart-baseline' : 'chart-line', style: `bottom: ${(t / top) * 100}%` }))),
        h('div', { class: 'chart-cols' },
          ...data.map((m) => {
            const text = monthText(m);
            return h('div', { class: 'chart-month', tabindex: 0, role: 'img', 'aria-label': text, 'data-month': m.key },
              h('div', { class: 'chart-bars' }, bar('sales', m.total, top), bar('profit', m.profit, top)),
              h('span', { class: 'chart-month-label', 'aria-hidden': 'true' }, formatMonth(m.key, 'short')),
              h('span', { class: 'chart-tip', 'aria-hidden': 'true' },
                h('strong', null, formatMonth(m.key, 'long')),
                h('span', { class: 'muted' }, plural(m.count, 'venda', 'vendas')),
                h('span', { class: 'chart-tip-row' }, key('sales', 'Vendido'), h('span', { class: 'mono' }, formatBRL(m.total))),
                h('span', { class: 'chart-tip-row' }, key('profit', 'Lucro'), h('span', { class: 'mono' }, formatBRL(m.profit))),
              ),
            );
          })),
      ),
    ),
    table(data),
  );
}
