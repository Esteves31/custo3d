import { formatBRL, formatDateTime, monthName } from '../calc/format';
import { filterSalesByPaid, loadSales, salesByMonth, salesTotals, type Sale } from '../store/sales';
import { mountBackupCard } from './backupCard';
import { monthColumns } from './chart';
import { h } from './dom';
import { plural, quoteDetails } from './listParts';

export type SummaryView = {
  /** Lê as vendas de novo (outra tela ou outra aba pode ter mudado) e redesenha. */
  refresh: () => void;
  focusTitle: () => void;
};

export type SummaryActions = {
  /** Abre Itens vendidos já filtrado em "A receber". */
  showPending: () => void;
  /** Um backup acabou de ser restaurado: as outras telas precisam ler de novo. */
  onRestored: () => void;
};

const CHART_MONTHS = 6;
const RECENT_COUNT = 5;

function tile(label: string, value: string, sub: string, ...extra: (Node | false)[]): HTMLElement {
  return h('div', { class: 'tile' },
    h('span', { class: 'tile-label' }, label),
    h('span', { class: 'stat-number' }, value),
    h('span', { class: 'tile-sub' }, sub),
    ...extra,
  );
}

function recentRow(s: Sale): HTMLElement {
  return h('tr', { class: s.paid ? null : 'is-pending' },
    h('td', { class: 'date' }, formatDateTime(new Date(s.soldAt))),
    h('td', { class: 'piece' },
      h('span', { class: 'quote-name' }, s.fileName),
      h('span', { class: 'quote-detail' }, quoteDetails(s)),
    ),
    h('td', { class: 'num quote-price' }, formatBRL(s.price)),
    h('td', { class: 'paid' },
      s.paid ? h('span', { class: 'badge-ok' }, 'Pago') : h('span', { class: 'badge-pending' }, 'A receber'),
    ),
  );
}

/** Monta a tela de Resumo em `root`: números do mês, gráfico por mês e últimas vendas. */
export function mountSummary(root: HTMLElement, actions: SummaryActions): SummaryView {
  // O título é sempre o mesmo nó: o foco continua nele depois de redesenhar.
  const title = h('h1', { id: 'summary-title', class: 'card-title page-title', tabindex: -1 }, 'Resumo');

  function empty(): HTMLElement[] {
    return [
      h('section', { class: 'card summary-card', 'aria-labelledby': 'summary-title' },
        title,
        h('div', { class: 'empty-state summary-empty' },
          h('p', null, h('strong', null, 'Nenhuma venda ainda.'), ' Aqui vão aparecer o total vendido e o lucro de cada mês, o que falta receber e as últimas vendas.'),
          h('ol', { class: 'summary-steps' },
            h('li', null, 'Na Calculadora, abra o arquivo fatiado e clique em "Salvar no histórico".'),
            h('li', null, 'No Histórico, clique em "Vendido" na cotação que virou venda.'),
          ),
          h('a', { class: 'btn btn-primary', href: '#calculadora' }, 'Abrir a calculadora'),
          h('p', { class: 'small' }, 'Já usava o Custo3D em outro navegador ou computador? Use "Restaurar backup", logo abaixo.'),
        ),
      ),
    ];
  }

  function filled(all: Sale[]): HTMLElement[] {
    const months = salesByMonth(all, CHART_MONTHS);
    const current = months[months.length - 1]!;
    const previous = months[months.length - 2]!;
    const totals = salesTotals(all);
    const pendingCount = filterSalesByPaid(all, 'pending').length;
    const month = monthName(current.key);

    const pending = tile('A receber', formatBRL(totals.pending),
      pendingCount ? plural(pendingCount, 'venda sem pagamento', 'vendas sem pagamento') : 'Tudo recebido',
      pendingCount > 0 && h('button', { type: 'button', class: 'btn btn-sm btn-secondary', 'data-show-pending': '', onclick: actions.showPending }, 'Ver quais'));
    pending.classList.toggle('is-pending', totals.pending > 0);

    return [
      h('section', { class: 'card summary-card', 'aria-labelledby': 'summary-title' },
        h('div', { class: 'history-head' },
          h('div', { class: 'history-id' }, title, h('span', { class: 'muted small' }, `${plural(all.length, 'venda', 'vendas')} · valores por peça`)),
        ),
        h('div', { class: 'stats summary-kpis' },
          tile(`Vendido em ${month}`, formatBRL(current.total),
            `${plural(current.count, 'venda', 'vendas')} · mês passado ${formatBRL(previous.total)}`),
          tile(`Lucro em ${month}`, formatBRL(current.profit), `mês passado ${formatBRL(previous.profit)}`),
          pending,
          tile('Total vendido', formatBRL(totals.total), `recebido ${formatBRL(totals.received)}`),
        ),
      ),
      h('section', { class: 'card summary-card summary-chart', 'aria-labelledby': 'summary-chart-title' },
        h('div', { class: 'section-head' },
          h('h2', { id: 'summary-chart-title', class: 'card-title' }, 'Vendas e lucro por mês'),
          h('span', { class: 'muted small' }, `Últimos ${CHART_MONTHS} meses`),
        ),
        monthColumns(months),
      ),
      h('section', { class: 'card summary-card summary-recent', 'aria-labelledby': 'summary-recent-title' },
        h('div', { class: 'section-head' },
          h('h2', { id: 'summary-recent-title', class: 'card-title' }, 'Últimas vendas'),
          h('a', { class: 'link', href: '#vendidos' }, 'Ver todas'),
        ),
        h('div', { class: 'table-wrap' },
          h('table', { class: 'history-table recent-table' },
            h('caption', { class: 'sr-only' }, `As ${RECENT_COUNT} vendas mais recentes`),
            h('thead', null,
              h('tr', null,
                h('th', { scope: 'col' }, 'Vendido em'),
                h('th', { scope: 'col' }, 'Peça'),
                h('th', { scope: 'col', class: 'num' }, 'Preço'),
                h('th', { scope: 'col' }, 'Pagamento'),
              ),
            ),
            h('tbody', null, ...all.slice(0, RECENT_COUNT).map(recentRow)),
          ),
        ),
      ),
    ];
  }

  const backup = mountBackupCard(() => {
    render();
    actions.onRestored();
  });
  root.append(backup.element);

  function render(): void {
    const all = loadSales();
    // O cartão de backup fica sempre no fim e nunca sai da página: o foco no botão clicado não se perde.
    for (const el of Array.from(root.children)) if (el !== backup.element) el.remove();
    backup.element.before(...(all.length === 0 ? empty() : filled(all)));
    backup.refresh();
  }

  render();
  return { refresh: render, focusTitle: () => title.focus() };
}
