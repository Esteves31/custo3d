import { formatBRL, formatDateTime, formatPercent } from '../calc/format';
import { searchQuotes } from '../store/history';
import {
  filterSalesByDate, filterSalesByPaid, loadSales, removeSale, salesToCsv, salesTotals, setPaid, type PaidFilter, type Sale,
} from '../store/sales';
import { h } from './dom';
import { downloadCsv, plural, quoteDetails } from './listParts';

export type SalesView = {
  /** Lê as vendas de novo (o Histórico ou outra aba pode ter mudado) e redesenha a lista. */
  refresh: () => void;
  focusTitle: () => void;
  /** Tira a busca e as datas e mostra só as vendas "A receber". */
  showPending: () => void;
};

function totalTile(label: string): { tile: HTMLElement; value: HTMLElement } {
  const value = h('span', { class: 'stat-number' }, '—');
  return { tile: h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), value), value };
}

const PAID_OPTIONS: [filter: PaidFilter, label: string][] = [['all', 'Todos'], ['pending', 'A receber'], ['paid', 'Pagos']];

/** Monta a tela de Itens vendidos em `root`. `onChange` recebe a lista completa a cada atualização. */
export function mountSales(root: HTMLElement, onChange: (list: Sale[]) => void): SalesView {
  const title = h('h1', { id: 'sales-title', class: 'card-title page-title', tabindex: -1 }, 'Itens vendidos');
  const count = h('span', { class: 'muted small' });
  const exportButton = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Exportar CSV');
  const search = h('input', { id: 'sales-search', type: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: 'ex.: chaveiro' });
  const from = h('input', { id: 'sales-from', type: 'date' });
  const to = h('input', { id: 'sales-to', type: 'date' });
  const clearButton = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Limpar filtros');
  let paidFilter: PaidFilter = 'all';
  const paidChips = PAID_OPTIONS.map(([filter, label]) =>
    h('button', { type: 'button', class: 'chip', 'data-filter': filter, onclick: () => pickPaid(filter) }, label));
  const totals = { total: totalTile('Total vendido'), received: totalTile('Recebido'), pending: totalTile('A receber') };
  const body = h('div', { class: 'history-body' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  root.replaceChildren(
    h('section', { class: 'card history', 'aria-labelledby': 'sales-title' },
      h('div', { class: 'history-head' },
        h('div', { class: 'history-id' }, title, count),
        exportButton,
      ),
      h('div', { class: 'filters' },
        h('div', { class: 'field filter-search' },
          h('label', { for: 'sales-search' }, 'Buscar pelo nome do arquivo'),
          search,
        ),
        h('div', { class: 'field' }, h('label', { for: 'sales-from' }, 'Vendidos desde'), from),
        h('div', { class: 'field' }, h('label', { for: 'sales-to' }, 'Vendidos até'), to),
      ),
      h('div', { class: 'filters-foot' },
        h('div', { class: 'field', role: 'group', 'aria-labelledby': 'sales-paid-label' },
          h('span', { class: 'field-label', id: 'sales-paid-label' }, 'Pagamento'),
          h('div', { class: 'chips' }, ...paidChips),
        ),
        clearButton,
      ),
      h('div', { class: 'stats sales-summary', 'aria-label': 'Totais das vendas mostradas' },
        totals.total.tile, totals.received.tile, totals.pending.tile,
      ),
      body,
      h('p', { class: 'muted small' }, 'Os valores são por peça. Ficam guardados só neste navegador. Para não perder nada, faça um backup no Resumo.'),
      live,
    ),
  );

  let shown: Sale[] = [];

  function row(s: Sale): HTMLElement {
    const when = formatDateTime(new Date(s.soldAt));
    return h('tr', { class: s.paid ? null : 'is-pending' },
      h('td', { class: 'date' }, when),
      h('td', { class: 'piece' },
        h('span', { class: 'quote-name' }, s.fileName),
        h('span', { class: 'quote-detail' }, quoteDetails(s)),
      ),
      h('td', { class: 'num cost' }, formatBRL(s.cost)),
      h('td', { class: 'num pct' }, formatPercent(s.profitPct)),
      h('td', { class: 'num quote-price' }, formatBRL(s.price)),
      h('td', { class: 'paid' },
        h('label', { class: 'check paid-check' },
          h('input', {
            type: 'checkbox',
            'data-paid': s.id,
            checked: s.paid,
            'aria-label': `Pago: ${s.fileName}, vendido em ${when}`,
            onchange: (e: Event) => togglePaid(s, (e.target as HTMLInputElement).checked),
          }),
          h('span', null, 'Pago'),
        ),
      ),
      h('td', { class: 'actions' },
        h('button', {
          type: 'button',
          class: 'btn btn-sm btn-danger',
          'data-delete': s.id,
          'aria-label': `Excluir venda de ${s.fileName}, ${when}`,
          onclick: () => remove(s),
        }, 'Excluir'),
      ),
    );
  }

  function render(): void {
    const all = loadSales();
    const filtered = search.value.trim() !== '' || from.value !== '' || to.value !== '' || paidFilter !== 'all';
    const badRange = from.value !== '' && to.value !== '' && from.value > to.value;
    shown = badRange ? [] : filterSalesByPaid(filterSalesByDate(searchQuotes(all, search.value), from.value, to.value), paidFilter);
    for (const chip of paidChips) chip.setAttribute('aria-pressed', String(chip.dataset.filter === paidFilter));

    count.textContent = filtered
      ? `${shown.length} de ${plural(all.length, 'venda', 'vendas')}`
      : plural(all.length, 'venda', 'vendas');
    exportButton.disabled = shown.length === 0;
    clearButton.disabled = !filtered;

    const sum = salesTotals(shown);
    totals.total.value.textContent = formatBRL(sum.total);
    totals.received.value.textContent = formatBRL(sum.received);
    totals.pending.value.textContent = formatBRL(sum.pending);
    totals.pending.tile.classList.toggle('is-pending', sum.pending > 0);

    if (all.length === 0) {
      body.replaceChildren(h('p', { class: 'empty-state' }, 'Nenhum item vendido ainda. No Histórico, use "Vendido" na cotação que virou venda.'));
    } else if (badRange) {
      body.replaceChildren(h('p', { class: 'empty-state' }, 'A data "Vendidos desde" está depois da data "Vendidos até".'));
    } else if (shown.length === 0) {
      body.replaceChildren(h('p', { class: 'empty-state' }, 'Nenhuma venda com esse filtro.'));
    } else {
      body.replaceChildren(
        h('div', { class: 'table-wrap' },
          h('table', { class: 'history-table sales-table' },
            h('caption', { class: 'sr-only' }, 'Itens vendidos, dos mais recentes para os mais antigos'),
            h('thead', null,
              h('tr', null,
                h('th', { scope: 'col' }, 'Vendido em'),
                h('th', { scope: 'col' }, 'Peça'),
                h('th', { scope: 'col', class: 'num' }, 'Custo'),
                h('th', { scope: 'col', class: 'num' }, 'Lucro'),
                h('th', { scope: 'col', class: 'num' }, 'Preço'),
                h('th', { scope: 'col' }, 'Pagamento'),
                h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Ações')),
              ),
            ),
            h('tbody', null, ...shown.map(row)),
          ),
        ),
      );
    }
    onChange(all);
  }

  function togglePaid(s: Sale, paid: boolean): void {
    if (!setPaid(s.id, paid)) {
      live.textContent = 'Não consegui salvar o pagamento. O navegador pode estar bloqueando o armazenamento.';
      render();
      return;
    }
    const position = shown.indexOf(s);
    render();
    // A lista foi redesenhada: o foco volta para a mesma caixa. Com o filtro "A receber" ou "Pagos",
    // a venda sai da lista; aí o foco vai para a próxima, ou para o título.
    const boxes = Array.from(body.querySelectorAll<HTMLInputElement>('input[data-paid]'));
    const same = boxes.find((i) => i.dataset.paid === s.id);
    (same ?? boxes[Math.min(position, boxes.length - 1)] ?? title).focus();
    live.textContent = `${s.fileName}: ${paid ? 'pago' : 'a receber'}.${same ? '' : ' Saiu desta lista.'}`;
  }

  function pickPaid(filter: PaidFilter): void {
    paidFilter = filter;
    render();
  }

  function remove(s: Sale): void {
    if (!window.confirm(`Excluir a venda de ${s.fileName} (${formatBRL(s.price)})?`)) return;
    const position = shown.indexOf(s);
    removeSale(s.id);
    render();
    // O botão clicado sumiu: o foco vai para o próximo da lista, ou para o título.
    const buttons = body.querySelectorAll<HTMLButtonElement>('button[data-delete]');
    (buttons[Math.min(position, buttons.length - 1)] ?? title).focus();
  }

  for (const input of [search, from, to]) input.addEventListener('input', render);
  clearButton.addEventListener('click', () => {
    search.value = '';
    from.value = '';
    to.value = '';
    paidFilter = 'all';
    render();
    search.focus();
  });
  exportButton.addEventListener('click', () => downloadCsv(salesToCsv(shown), 'vendidos'));

  function showPending(): void {
    search.value = '';
    from.value = '';
    to.value = '';
    paidFilter = 'pending';
    render();
  }

  render();
  return { refresh: render, focusTitle: () => title.focus(), showPending };
}
