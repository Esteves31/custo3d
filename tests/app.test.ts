import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { monthName } from '../src/calc/format';
import { loadHistory } from '../src/store/history';
import { loadSales, localDateKey, monthKey } from '../src/store/sales';
import { startApp } from '../src/ui/app';

// G-code real: 18,05 g e 55min 33s (3333 s) numa placa.
const SAMPLE = 'coaster_PLA_55m33s.gcode';
const sampleFile = () => new File([readFileSync(resolve(__dirname, '..', 'samples', SAMPLE))], SAMPLE);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string) => $(id).textContent;

function type(id: string, value: string): void {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function open(file: File): Promise<void> {
  const input = $<HTMLInputElement>('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(document.querySelector('.project-title')?.textContent).toBe(file.name), { timeout: 10_000 });
}

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
  document.body.innerHTML = '<div id="app"></div>';
  startApp($('app'));
  type('kg', '120');
  type('bag', '0,35');
  type('hour', '0,50');
  type('ring', '0,40');
  type('profit', '100');
});

describe('calculadora', () => {
  it('soma o tempo e só soma a argola com a caixa marcada', async () => {
    await open(sampleFile());

    // 18,05 g × R$ 0,12 = 2,166 · 0,9258 h × R$ 0,50 = 0,4629 · + sacolinha 0,35
    expect(text('time-label')).toBe('Tempo (55min 33s)');
    expect(text('time-cost')).toBe('R$ 0,46');
    expect($('ring-cost').closest('.row')!.hasAttribute('hidden')).toBe(true);
    expect(text('total-cost')).toBe('R$ 2,98');
    expect(text('price')).toBe('R$ 5,96');

    const ring = $<HTMLInputElement>('ring-on');
    ring.checked = true;
    ring.dispatchEvent(new Event('change'));
    expect(text('ring-cost')).toBe('R$ 0,40');
    expect(text('total-cost')).toBe('R$ 3,38');
    expect(text('price')).toBe('R$ 6,76');

    // Arquivo novo volta sem argola.
    await open(sampleFile());
    expect(ring.checked).toBe(false);
    expect(text('price')).toBe('R$ 5,96');
  });

  it('argola vazia só bloqueia o cálculo quando a caixa está marcada', async () => {
    type('ring', '');
    await open(sampleFile());
    expect(text('price')).toBe('R$ 5,96');

    const ring = $<HTMLInputElement>('ring-on');
    ring.checked = true;
    ring.dispatchEvent(new Event('change'));
    expect(text('price')).toBe('—');
    expect(text('result-note')).toBe('Preencha: Argola do chaveiro.');
  });

  it('guarda os valores novos para a próxima vez', () => {
    document.body.innerHTML = '<div id="app"></div>';
    startApp($('app'));
    expect($<HTMLInputElement>('hour').value).toBe('0,50');
    expect($<HTMLInputElement>('ring').value).toBe('0,40');
  });

  it('salva no histórico uma vez por cotação e mostra na aba', async () => {
    const save = $<HTMLButtonElement>('save');
    expect(save.disabled).toBe(true);

    await open(sampleFile());
    save.click();
    expect(loadHistory()).toHaveLength(1);
    expect(loadHistory()[0]).toMatchObject({ fileName: SAMPLE, pieces: 1, ringPrice: 0, hourPrice: 0.5, price: 5.96 });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(text('nav-count')).toBe('1');

    save.click(); // mesma cotação: não duplica
    expect(loadHistory()).toHaveLength(1);

    type('pieces', '2');
    expect(save.hasAttribute('aria-disabled')).toBe(false);
    save.click();
    expect(loadHistory().map((q) => q.pieces)).toEqual([2, 1]);

    location.hash = '#historico';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect($('view-history').hidden).toBe(false);
    expect($('view-calc').hidden).toBe(true);
    expect(document.querySelectorAll('.history-table tbody tr')).toHaveLength(2);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('button[data-delete]')!.click();
    expect(loadHistory().map((q) => q.pieces)).toEqual([1]);
    expect(text('nav-count')).toBe('1');
    // A cotação de 2 peças (na tela) foi excluída: dá para salvar de novo.
    expect(save.hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('itens vendidos', () => {
  const go = (hash: string) => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  const rows = () => document.querySelectorAll('#view-sales tbody tr');
  const soldButton = () => document.querySelector<HTMLButtonElement>('#view-history button[data-sold]')!;
  const paidBox = () => document.querySelector<HTMLInputElement>('#view-sales input[data-paid]')!;
  const tile = (label: string) =>
    Array.from(document.querySelectorAll('#view-sales .tile')).find((t) => t.querySelector('.tile-label')!.textContent === label)!
      .querySelector('.stat-number')!.textContent;

  beforeEach(async () => {
    await open(sampleFile());
    $<HTMLButtonElement>('save').click();
    go('#historico');
  });

  it('o botão Vendido manda a cotação para a aba e marca pago', () => {
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('#view-sales .empty-state')).not.toBeNull();

    soldButton().click();
    expect(loadSales()).toHaveLength(1);
    expect(soldButton().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(soldButton());
    expect(text('nav-sales-count')).toBe('1');

    soldButton().click(); // já vendida: não duplica
    expect(loadSales()).toHaveLength(1);

    go('#vendidos');
    expect($('view-sales').hidden).toBe(false);
    expect($('view-history').hidden).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(paidBox().checked).toBe(false);
    expect(tile('Total vendido')).toBe('R$ 5,96');
    expect(tile('A receber')).toBe('R$ 5,96');

    paidBox().click();
    expect(loadSales()[0]!.paid).toBe(true);
    expect(paidBox().checked).toBe(true);
    expect(document.activeElement).toBe(paidBox());
    expect(tile('Recebido')).toBe('R$ 5,96');
    expect(tile('A receber')).toBe('R$ 0,00');
  });

  it('filtra pela data da venda', () => {
    soldButton().click();
    go('#vendidos');
    const today = localDateKey(new Date());
    const setDate = (id: string, value: string) => type(id, value);

    setDate('sales-from', today);
    setDate('sales-to', today);
    expect(rows()).toHaveLength(1);

    setDate('sales-from', '2000-01-01');
    setDate('sales-to', '2000-01-31');
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('#view-sales .empty-state')!.textContent).toBe('Nenhuma venda com esse filtro.');
    expect(tile('Total vendido')).toBe('R$ 0,00');

    setDate('sales-from', '2000-02-01');
    expect(document.querySelector('#view-sales .empty-state')!.textContent).toContain('está depois');

    document.querySelector<HTMLButtonElement>('#view-sales .filters-foot .btn')!.click();
    expect(rows()).toHaveLength(1);
  });

  it('filtra a receber e pagos; marcar pago tira da lista "A receber"', async () => {
    soldButton().click();
    // Segunda venda: outra cotação do mesmo arquivo.
    await open(sampleFile());
    type('pieces', '2');
    $<HTMLButtonElement>('save').click();
    go('#historico');
    soldButton().click(); // a mais recente fica em cima
    go('#vendidos');
    expect(rows()).toHaveLength(2);

    const chip = (filter: string) => document.querySelector<HTMLButtonElement>(`#view-sales .chip[data-filter="${filter}"]`)!;
    expect(chip('all').getAttribute('aria-pressed')).toBe('true');

    paidBox().click(); // a de 2 peças fica paga
    chip('paid').click();
    expect(chip('paid').getAttribute('aria-pressed')).toBe('true');
    expect(chip('all').getAttribute('aria-pressed')).toBe('false');
    expect(rows()).toHaveLength(1);
    expect(loadSales().find((s) => s.id === paidBox().dataset.paid)!.pieces).toBe(2);
    expect(text('nav-sales-count')).toBe('2');

    chip('pending').click();
    expect(rows()).toHaveLength(1);
    expect(tile('Recebido')).toBe('R$ 0,00');
    paidBox().click();
    expect(rows()).toHaveLength(0);
    expect(document.activeElement).toBe($('sales-title'));
    expect(document.querySelector('#view-sales .empty-state')!.textContent).toBe('Nenhuma venda com esse filtro.');

    document.querySelector<HTMLButtonElement>('#view-sales .filters-foot .btn')!.click();
    expect(chip('all').getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(2);
  });

  it('excluir a venda deixa marcar de novo; excluir a cotação mantém a venda', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    soldButton().click();

    go('#vendidos');
    document.querySelector<HTMLButtonElement>('#view-sales button[data-delete]')!.click();
    expect(loadSales()).toHaveLength(0);
    expect(text('nav-sales-count')).toBe('');

    go('#historico');
    expect(soldButton().hasAttribute('aria-disabled')).toBe(false);
    soldButton().click();
    document.querySelector<HTMLButtonElement>('#view-history button[data-delete]')!.click();
    expect(loadHistory()).toHaveLength(0);
    go('#vendidos');
    expect(rows()).toHaveLength(1);
  });

  it('abrir um arquivo nessa aba volta para a calculadora', async () => {
    go('#vendidos');
    await open(sampleFile());
    expect(location.hash).toBe('#calculadora');
  });
});

describe('resumo', () => {
  const go = (hash: string) => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  const tile = (label: string) =>
    Array.from(document.querySelectorAll('#view-summary .tile')).find((t) => t.querySelector('.tile-label')!.textContent === label)
      ?.querySelector('.stat-number')!.textContent;
  const recentRows = () => document.querySelectorAll('#view-summary .recent-table tbody tr');
  const month = () => monthName(monthKey(new Date()));

  async function sellSample(): Promise<void> {
    await open(sampleFile());
    $<HTMLButtonElement>('save').click();
    go('#historico');
    document.querySelector<HTMLButtonElement>('#view-history button[data-sold]')!.click();
  }

  it('abre no Resumo e, sem vendas, mostra o passo a passo', () => {
    expect($('view-summary').hidden).toBe(false);
    expect($('view-calc').hidden).toBe(true);
    expect($('nav-summary').getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('#view-summary .summary-empty')).not.toBeNull();
    expect(document.querySelector('#view-summary a[href="#calculadora"]')).not.toBeNull();
    expect(document.querySelector('#view-summary .chart')).toBeNull();
  });

  it('mostra o mês atual, o que falta receber, o gráfico e as últimas vendas', async () => {
    await sellSample();
    go('#resumo');
    expect($('view-summary').hidden).toBe(false);
    expect(document.activeElement).toBe($('summary-title'));

    // Amostra real: preço R$ 5,96 e custo R$ 2,98.
    expect(tile(`Vendido em ${month()}`)).toBe('R$ 5,96');
    expect(tile(`Lucro em ${month()}`)).toBe('R$ 2,98');
    expect(tile('A receber')).toBe('R$ 5,96');
    expect(tile('Total vendido')).toBe('R$ 5,96');

    const columns = document.querySelectorAll('#view-summary .chart-month');
    expect(columns).toHaveLength(6);
    expect(columns[5]!.getAttribute('aria-label')).toContain('1 venda · Vendido R$ 5,96 · Lucro R$ 2,98');
    expect(columns[0]!.getAttribute('aria-label')).toContain('0 vendas');

    expect(recentRows()).toHaveLength(1);
    expect(recentRows()[0]!.textContent).toContain(SAMPLE);
    expect(recentRows()[0]!.querySelector('.badge-pending')!.textContent).toBe('A receber');
  });

  it('venda paga sai do "A receber"', async () => {
    await sellSample();
    go('#vendidos');
    document.querySelector<HTMLInputElement>('#view-sales input[data-paid]')!.click();
    go('#resumo');
    expect(tile('A receber')).toBe('R$ 0,00');
    expect(document.querySelector('#view-summary [data-show-pending]')).toBeNull();
    expect(recentRows()[0]!.querySelector('.badge-ok')!.textContent).toBe('Pago');
  });

  it('"Ver quais" abre Itens vendidos só com as vendas a receber', async () => {
    await sellSample();
    go('#vendidos');
    type('sales-search', 'nada com esse nome');
    go('#resumo');

    document.querySelector<HTMLButtonElement>('#view-summary [data-show-pending]')!.click();
    await vi.waitFor(() => expect($('view-sales').hidden).toBe(false));
    expect(location.hash).toBe('#vendidos');
    expect(document.querySelector('#view-sales .chip[data-filter="pending"]')!.getAttribute('aria-pressed')).toBe('true');
    expect($<HTMLInputElement>('sales-search').value).toBe('');
    expect(document.querySelectorAll('#view-sales tbody tr')).toHaveLength(1);
  });
});

describe('backup', () => {
  const go = (hash: string) => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  const chooseBackup = (file: File) => {
    const input = $<HTMLInputElement>('backup-file');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  it('baixa tudo num arquivo e restaura num navegador limpo', async () => {
    await open(sampleFile());
    $<HTMLButtonElement>('save').click();
    go('#historico');
    document.querySelector<HTMLButtonElement>('#view-history button[data-sold]')!.click();
    go('#resumo');
    expect($('backup-status').classList.contains('is-warn')).toBe(true);

    let blob: Blob | undefined;
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blob = b as Blob;
      return 'blob:backup';
    };
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    $<HTMLButtonElement>('backup-save').click();
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^custo3d-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(text('backup-message')).toContain('Backup salvo');
    expect($('backup-status').classList.contains('is-warn')).toBe(false);
    const json = await blob!.text();

    // Navegador limpo: abre vazio.
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    startApp($('app'));
    expect($<HTMLInputElement>('kg').value).toBe('');
    expect(document.querySelector('#view-summary .summary-empty')).not.toBeNull();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    chooseBackup(new File([json], 'custo3d-backup.json'));
    await vi.waitFor(() => expect(text('backup-message')).toContain('Backup restaurado'));
    expect(confirm.mock.calls[0]![0]).toContain('1 venda e 1 cotação');
    expect(document.querySelector('#view-summary .summary-empty')).toBeNull();
    expect(text('nav-count')).toBe('1');
    expect(text('nav-sales-count')).toBe('1');
    expect($<HTMLInputElement>('kg').value).toBe('120');
    vi.restoreAllMocks();
  });

  it('avisa quando o arquivo não é um backup e não mexe em nada', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    chooseBackup(new File(['{"qualquer": 1}'], 'outro.json'));
    await vi.waitFor(() => expect(text('backup-message')).toContain('não é um backup'));
    expect($('backup-message').classList.contains('is-error')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
