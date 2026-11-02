import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { monthName } from '../src/calc/format';
import { loadHistory } from '../src/store/history';
import { loadSales, localDateKey, monthKey } from '../src/store/sales';
import { startApp } from '../src/ui/app';
import { multiPlate } from './fixtures';

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

function tick(id: string, checked = true): void {
  const box = $<HTMLInputElement>(id);
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
}

/** Linha do resultado de um adicional ("pouch" → linha do Saquinho). */
const costRow = (id: string) => $(`${id}-cost`).closest<HTMLElement>('.row')!;

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
    expect(text('result-note')).toBe('Preencha: Argola de chaveiro.');
  });

  it('guarda os valores novos para a próxima vez', () => {
    type('pouch', '0,20');
    type('key-pouch', '0,15');
    type('led', '3,00');
    type('other', '1,00');
    document.body.innerHTML = '<div id="app"></div>';
    startApp($('app'));
    expect($<HTMLInputElement>('hour').value).toBe('0,50');
    expect($<HTMLInputElement>('ring').value).toBe('0,40');
    expect(['pouch', 'key-pouch', 'led'].map((id) => $<HTMLInputElement>(id).value)).toEqual(['0,20', '0,15', '3,00']);
    // Outros vale só para a peça: não fica salvo.
    expect($<HTMLInputElement>('other').value).toBe('');
  });

  it('adicionais só somam quando marcados; Outros vazio vale zero', async () => {
    type('pouch', '0,20');
    type('key-pouch', '0,15');
    type('led', '');
    await open(sampleFile());
    expect(text('price')).toBe('R$ 5,96');
    for (const id of ['ring', 'pouch', 'key-pouch', 'led', 'other']) expect(costRow(id).hidden).toBe(true);

    tick('pouch-on');
    tick('led-on');
    expect(text('result-note')).toBe('Preencha: Vela LED.');
    type('led', '3');
    // 2,9789 + saquinho 0,20 + vela LED 3,00
    expect(text('pouch-cost')).toBe('R$ 0,20');
    expect(text('led-cost')).toBe('R$ 3,00');
    expect(costRow('pouch').hidden).toBe(false);
    expect(costRow('key-pouch').hidden).toBe(true);
    expect(text('total-cost')).toBe('R$ 6,18');
    expect(text('price')).toBe('R$ 12,36');

    type('other', 'abc');
    expect(text('result-note')).toBe('Corrija o campo destacado.');
    type('other', '1');
    type('other-note', 'ímã');
    expect(costRow('other').hidden).toBe(false);
    expect(text('other-label')).toBe('Outros (ímã)');
    expect(text('other-cost')).toBe('R$ 1,00');
    expect(text('price')).toBe('R$ 14,36');

    const save = $<HTMLButtonElement>('save');
    save.click();
    expect(loadHistory()[0]).toMatchObject({
      ringPrice: 0, pouchPrice: 0.2, keyPouchPrice: 0, ledPrice: 3, otherPrice: 1, otherNote: 'ímã', price: 14.36,
    });
    // A descrição vai na cotação: mudar o texto deixa salvar de novo.
    type('other-note', 'ímã forte');
    expect(save.hasAttribute('aria-disabled')).toBe(false);

    // Arquivo novo: nada marcado e Outros vazio; os preços salvos continuam.
    await open(sampleFile());
    expect(['ring-on', 'pouch-on', 'key-pouch-on', 'led-on'].map((id) => $<HTMLInputElement>(id).checked)).toEqual([false, false, false, false]);
    expect($<HTMLInputElement>('other').value).toBe('');
    expect($<HTMLInputElement>('other-note').value).toBe('');
    expect($<HTMLInputElement>('pouch').value).toBe('0,20');
    expect(text('price')).toBe('R$ 5,96');

    location.hash = '#historico';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(document.querySelector('#view-history .quote-detail')!.textContent)
      .toBe('Placa 1 · 1 peça · 18,05 g por peça · 55min 33s · com saquinho, vela LED e ímã');
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

  it('"Todas juntas" soma as placas e cobra sacolinha uma vez só', async () => {
    const plate = (choice: string) => document.querySelector<HTMLButtonElement>(`[data-plate="${choice}"]`)!;
    const stats = () => Array.from(document.querySelectorAll('#project .stat-number'), (el) => el.textContent);
    const piecesLabel = () => document.querySelector('label[for="pieces"]')!.textContent;

    // Placa 1: 48,6 g e 2h 14min · Placa 2: 22,1 g e 1h 5min
    await open(new File([new Uint8Array(await multiPlate())], 'robo.gcode.3mf'));
    expect(document.querySelectorAll('.plates .chip')).toHaveLength(3);
    expect(text('price')).toBe('R$ 14,60');
    type('pieces', '3');
    tick('ring-on');
    type('pouch', '0,20');
    tick('pouch-on');
    type('other', '0,50');

    plate('all').click();
    expect(plate('all').getAttribute('aria-pressed')).toBe('true');
    expect(stats()).toEqual(['70,7 g', '3h 19min']);
    expect(piecesLabel()).toBe('Peças (todas as placas juntas)');
    // Peças, adicionais e Outros da Placa 1 não vêm junto.
    expect($<HTMLInputElement>('pieces').value).toBe('1');
    expect($<HTMLInputElement>('ring-on').checked).toBe(false);
    expect($<HTMLInputElement>('pouch-on').checked).toBe(false);
    expect($<HTMLInputElement>('other').value).toBe('');
    // 70,7 g × R$ 0,12 = 8,484 · 3,3167 h × R$ 0,50 = 1,6583 · + uma sacolinha 0,35
    expect(text('total-cost')).toBe('R$ 10,49');
    expect(text('price')).toBe('R$ 20,98');

    $<HTMLButtonElement>('save').click();
    expect(loadHistory()).toHaveLength(1);
    expect(loadHistory()[0]).toMatchObject({ plate: 1, plates: [1, 2], pieces: 1, price: 20.98 });

    type('pieces', '2');
    expect(text('res-pieces')).toBe('2 peças nas placas juntas');
    expect(text('price')).toBe('R$ 10,84');
    type('pieces', '');
    expect(text('result-note')).toBe('Preencha: Peças (todas as placas juntas).');
    type('pieces', '2');

    // Volta para a Placa 1 com as peças, os adicionais e o Outros dela.
    plate('0').click();
    expect(piecesLabel()).toBe('Peças nesta placa');
    expect($<HTMLInputElement>('pieces').value).toBe('3');
    expect($<HTMLInputElement>('ring-on').checked).toBe(true);
    expect($<HTMLInputElement>('pouch-on').checked).toBe(true);
    expect($<HTMLInputElement>('other').value).toBe('0,50');
    plate('all').click();
    expect($<HTMLInputElement>('pieces').value).toBe('2');

    location.hash = '#historico';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(document.querySelector('#view-history .quote-detail')!.textContent).toBe('Placas 1 e 2 · 1 peça · 70,7 g por peça · 3h 19min');
  });

  it('arquivo de uma placa não mostra "Todas juntas"', async () => {
    await open(sampleFile());
    expect(document.querySelectorAll('.plates .chip')).toHaveLength(1);
    expect(document.querySelector('[data-plate="all"]')).toBeNull();
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
