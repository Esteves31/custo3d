import { formatBRL, formatDateTime, formatPercent } from '../calc/format';
import { HISTORY_LIMIT, historyToCsv, loadHistory, removeQuote, searchQuotes, type Quote } from '../store/history';
import { loadSales, markSold } from '../store/sales';
import { h, icon, ICONS } from './dom';
import { downloadCsv, plural, quoteDetails } from './listParts';

export type HistoryView = {
  /** Lê o histórico de novo (outra aba pode ter salvo) e redesenha a lista. */
  refresh: () => void;
  focusTitle: () => void;
};

export type HistoryEvents = {
  /** Recebe a lista completa a cada atualização. */
  onChange: (list: Quote[]) => void;
  /** Uma cotação acabou de ir para Itens vendidos. */
  onSold: () => void;
};

/** Monta a tela do histórico em `root`. */
export function mountHistory(root: HTMLElement, events: HistoryEvents): HistoryView {
  const title = h('h1', { id: 'hist-title', class: 'card-title page-title', tabindex: -1 }, 'Histórico');
  const count = h('span', { class: 'muted small' });
  const search = h('input', { id: 'hist-search', type: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: 'ex.: chaveiro' });
  const exportButton = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Exportar CSV');
  const body = h('div', { class: 'history-body' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  root.replaceChildren(
    h('section', { class: 'card history', 'aria-labelledby': 'hist-title' },
      h('div', { class: 'history-head' },
        h('div', { class: 'history-id' }, title, count),
        exportButton,
      ),
      h('div', { class: 'field history-search' },
        h('label', { for: 'hist-search' }, 'Buscar pelo nome do arquivo'),
        search,
      ),
      body,
      h('p', { class: 'muted small' }, `Ficam guardadas as últimas ${HISTORY_LIMIT} cotações, só neste navegador. Para não perder nada, faça um backup no Resumo.`),
      live,
    ),
  );

  let shown: Quote[] = [];
  let soldIds = new Set<string>();

  function soldButton(q: Quote, when: string): HTMLElement {
    if (soldIds.has(q.id)) {
      // aria-disabled em vez de disabled, para o foco do teclado não se perder logo depois do clique.
      return h('button', {
        type: 'button',
        class: 'btn btn-sm btn-sold',
        'data-sold': q.id,
        'aria-disabled': 'true',
        'aria-label': `Vendido: ${q.fileName}, ${when}, já está em Itens vendidos`,
      }, icon(ICONS.check), 'Vendido');
    }
    return h('button', {
      type: 'button',
      class: 'btn btn-sm btn-secondary',
      'data-sold': q.id,
      'aria-label': `Vendido: mandar ${q.fileName}, ${when}, para Itens vendidos`,
      onclick: () => sell(q),
    }, 'Vendido');
  }

  function row(q: Quote): HTMLElement {
    const when = formatDateTime(new Date(q.savedAt));
    return h('tr', null,
      h('td', { class: 'date' }, when),
      h('td', { class: 'piece' },
        h('span', { class: 'quote-name' }, q.fileName),
        h('span', { class: 'quote-detail' }, quoteDetails(q)),
      ),
      h('td', { class: 'num cost' }, formatBRL(q.cost)),
      h('td', { class: 'num pct' }, formatPercent(q.profitPct)),
      h('td', { class: 'num quote-price' }, formatBRL(q.price)),
      h('td', { class: 'actions' },
        h('div', { class: 'row-actions' },
          soldButton(q, when),
          h('button', {
            type: 'button',
            class: 'btn btn-sm btn-danger',
            'data-delete': q.id,
            'aria-label': `Excluir cotação de ${q.fileName}, ${when}`,
            onclick: () => remove(q),
          }, 'Excluir'),
        ),
      ),
    );
  }

  function render(): void {
    const all = loadHistory();
    soldIds = new Set(loadSales().map((s) => s.quoteId));
    shown = searchQuotes(all, search.value);
    const filtered = search.value.trim() !== '';
    count.textContent = filtered
      ? `${shown.length} de ${plural(all.length, 'cotação', 'cotações')}`
      : plural(all.length, 'cotação', 'cotações');
    exportButton.disabled = shown.length === 0;

    if (all.length === 0) {
      body.replaceChildren(h('p', { class: 'empty-state' }, 'Nenhuma cotação salva ainda. Na calculadora, use "Salvar no histórico".'));
    } else if (shown.length === 0) {
      body.replaceChildren(h('p', { class: 'empty-state' }, 'Nenhuma cotação com esse nome.'));
    } else {
      body.replaceChildren(
        h('div', { class: 'table-wrap' },
          h('table', { class: 'history-table' },
            h('caption', { class: 'sr-only' }, 'Cotações salvas, das mais recentes para as mais antigas'),
            h('thead', null,
              h('tr', null,
                h('th', { scope: 'col' }, 'Data'),
                h('th', { scope: 'col' }, 'Peça'),
                h('th', { scope: 'col', class: 'num' }, 'Custo'),
                h('th', { scope: 'col', class: 'num' }, 'Lucro'),
                h('th', { scope: 'col', class: 'num' }, 'Preço'),
                h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Ações')),
              ),
            ),
            h('tbody', null, ...shown.map(row)),
          ),
        ),
      );
    }
    events.onChange(all);
  }

  function sell(q: Quote): void {
    if (!markSold(q)) {
      live.textContent = 'Não consegui marcar como vendido. O navegador pode estar bloqueando o armazenamento.';
      return;
    }
    render();
    events.onSold();
    // O botão foi redesenhado: o foco volta para ele, agora "Vendido" marcado.
    Array.from(body.querySelectorAll<HTMLButtonElement>('button[data-sold]')).find((b) => b.dataset.sold === q.id)?.focus();
    live.textContent = `${q.fileName} foi para Itens vendidos.`;
  }

  function remove(q: Quote): void {
    const keepsSale = soldIds.has(q.id) ? ' A venda continua em Itens vendidos.' : '';
    if (!window.confirm(`Excluir a cotação de ${q.fileName} (${formatBRL(q.price)})?${keepsSale}`)) return;
    const position = shown.indexOf(q);
    removeQuote(q.id);
    render();
    // O botão clicado sumiu: o foco vai para o próximo da lista, ou para o título.
    const buttons = body.querySelectorAll<HTMLButtonElement>('button[data-delete]');
    (buttons[Math.min(position, buttons.length - 1)] ?? title).focus();
  }

  search.addEventListener('input', render);
  exportButton.addEventListener('click', () => downloadCsv(historyToCsv(shown), 'historico'));

  render();
  return { refresh: render, focusTitle: () => title.focus() };
}
