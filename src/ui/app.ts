import { formatBRL, formatDuration, formatGrams, formatInput, formatPercent } from '../calc/format';
import { computePrice, type Rounding } from '../calc/price';
import { validateField, type FieldKind, type FieldResult } from '../calc/validate';
import { parseFile, ParseError, INVALID_FILE_MESSAGE } from '../parser';
import { addQuote, type NewQuote } from '../store/history';
import { loadValues, saveValues, type SavedValues } from '../store/settings';
import { byId, ICONS } from './dom';
import { mountHistory } from './historyView';
import { renderPanel, selectedPlate, type PanelActions, type PanelState, type PlateChoice } from './projectPanel';
import { mountSales } from './salesView';
import { mountSummary } from './summaryView';

// Configurável na Fase 4 (Padrões).
const ROUNDING: Rounding = 'none';

const PIECES_LABEL = { one: 'Peças nesta placa', all: 'Peças (todas as placas juntas)' };

type AddonKey = 'ring' | 'pouch' | 'keyPouch' | 'led';

/**
 * Adicionais com preço salvo em "Seus valores" e uma caixa por peça: só somam quando marcados.
 * `key` é a chave em SavedValues; `id` é o do campo de preço (a caixa é `${id}-on`).
 */
const ADDONS: readonly { key: AddonKey; id: string; name: string; short: string; placeholder: string }[] = [
  { key: 'ring', id: 'ring', name: 'Argola de chaveiro', short: 'Argola', placeholder: 'ex.: 0,40' },
  { key: 'pouch', id: 'pouch', name: 'Saquinho', short: 'Saquinho', placeholder: 'ex.: 0,20' },
  { key: 'keyPouch', id: 'key-pouch', name: 'Saquinho de chaveiro', short: 'Saquinho de chaveiro', placeholder: 'ex.: 0,15' },
  { key: 'led', id: 'led', name: 'Vela LED', short: 'Vela LED', placeholder: 'ex.: 3,00' },
];

const field = (id: string, label: string, placeholder: string, inputmode: string, labelClass = '') => `
  <div class="field">
    <label for="${id}"${labelClass && ` class="${labelClass}"`}>${label}</label>
    <input id="${id}" type="text" inputmode="${inputmode}" autocomplete="off" spellcheck="false" placeholder="${placeholder}" aria-describedby="${id}-error">
    <p class="field-error" id="${id}-error" hidden></p>
  </div>`;

const addonRow = (a: (typeof ADDONS)[number]) => `
  <div class="addon">
    <label class="check"><input type="checkbox" id="${a.id}-on"><span>${a.name}</span></label>
    ${field(a.id, `${a.name} (R$ por unidade)`, a.placeholder, 'decimal', 'sr-only')}
  </div>`;

const row = (labelId: string, label: string, valueId: string, extra = '') => `
  <div class="row${extra}"><dt id="${labelId}">${label}</dt><dd id="${valueId}">—</dd></div>`;

const SHELL = `
<header class="topbar">
  <div class="brand"><span class="brand-icon" aria-hidden="true">${ICONS.cube}</span><span class="brand-name">Custo3D</span></div>
  <nav class="nav" aria-label="Principal">
    <a class="nav-link" id="nav-summary" href="#resumo">Resumo</a>
    <a class="nav-link" id="nav-calc" href="#calculadora">Calculadora</a>
    <a class="nav-link" id="nav-history" href="#historico">Histórico <span class="nav-count" id="nav-count"></span></a>
    <a class="nav-link" id="nav-sales" href="#vendidos">Itens vendidos <span class="nav-count" id="nav-sales-count"></span></a>
  </nav>
  <p class="topbar-note">Funciona sem internet · seus arquivos não saem do computador</p>
</header>
<main class="layout" id="view-summary"></main>
<main class="layout" id="view-calc" hidden>
  <section class="card project" id="project" aria-labelledby="proj-title"></section>
  <div class="column">
    <section class="card values" aria-labelledby="vals-title">
      <h2 id="vals-title" class="card-title">Seus valores</h2>
      <div class="fields">
        ${field('kg', 'Filamento (R$ por kg)', 'ex.: 120,00', 'decimal')}
        ${field('bag', 'Sacolinha (R$ por unidade)', 'ex.: 0,35', 'decimal')}
        ${field('hour', 'Tempo de impressão (R$ por hora)', 'ex.: 0,50', 'decimal')}
        ${field('profit', 'Lucro sobre o custo (%)', 'ex.: 150', 'decimal')}
        ${field('pieces', PIECES_LABEL.one, '1', 'numeric')}
      </div>
      <div class="addons" role="group" aria-labelledby="addons-title">
        <div class="addons-head">
          <h3 id="addons-title" class="field-label">Adicionais</h3>
          <span class="muted small">R$ por unidade</span>
        </div>
        ${ADDONS.map(addonRow).join('')}
        <div class="fields">
          ${field('other', 'Outros (R$ por peça)', 'ex.: 1,00', 'decimal')}
          <div class="field">
            <label for="other-note">O que é (opcional)</label>
            <input id="other-note" type="text" autocomplete="off" maxlength="40" placeholder="ex.: ímã">
          </div>
        </div>
      </div>
      <p class="muted small">Os valores ficam salvos e já vêm preenchidos no próximo projeto. Peças, adicionais marcados e Outros valem só para a placa escolhida.</p>
    </section>
    <section class="result" aria-labelledby="res-title">
      <div class="result-head">
        <h2 id="res-title" class="card-title">Por peça</h2>
        <span id="res-pieces" class="result-pieces"></span>
      </div>
      <dl class="breakdown">
        ${row('fil-label', 'Filamento', 'fil-cost')}
        ${row('bag-label', 'Sacolinha', 'bag-cost')}
        ${ADDONS.map((a) => row(`${a.id}-label`, a.short, `${a.id}-cost`)).join('')}
        ${row('other-label', 'Outros', 'other-cost')}
        ${row('time-label', 'Tempo de impressão', 'time-cost')}
        ${row('total-label', 'Custo total', 'total-cost', ' total')}
        ${row('profit-label', 'Lucro', 'profit-value', ' profit')}
      </dl>
      <p id="result-note" class="result-note"></p>
      <div class="price-row">
        <div class="price-box">
          <span class="eyebrow accent" id="price-label">Preço de venda</span>
          <output id="price" class="price" aria-labelledby="price-label">—</output>
        </div>
        <div class="price-actions">
          <button type="button" class="btn btn-ghost-dark" id="copy" disabled>Copiar preço</button>
          <button type="button" class="btn btn-primary" id="save" disabled>Salvar no histórico</button>
        </div>
      </div>
      <p class="sr-only" id="live" aria-live="polite"></p>
    </section>
  </div>
</main>
<main class="layout" id="view-history" hidden></main>
<main class="layout" id="view-sales" hidden></main>
<footer class="footer">Custo3D · versão de <span id="build-time"></span></footer>
<input type="file" id="file-input" accept=".3mf,.gcode" hidden>
<div class="drop-overlay" id="drop-overlay" aria-hidden="true"><div class="drop-overlay-box">Solte o arquivo para calcular</div></div>
`;

type Field = {
  input: HTMLInputElement;
  error: HTMLElement;
  kind: FieldKind;
  label: string;
  result: FieldResult;
};

function makeField(id: string, kind: FieldKind, label: string): Field {
  return { input: byId<HTMLInputElement>(id), error: byId(`${id}-error`), kind, label, result: { status: 'empty' } };
}

function check(f: Field): FieldResult {
  f.result = validateField(f.input.value, f.kind);
  if (f.result.status === 'invalid') {
    f.input.setAttribute('aria-invalid', 'true');
    f.error.textContent = f.result.message;
    f.error.hidden = false;
  } else {
    f.input.removeAttribute('aria-invalid');
    f.error.textContent = '';
    f.error.hidden = true;
  }
  return f.result;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Reserva para navegadores que negam a Clipboard API.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function startApp(root: HTMLElement): void {
  root.innerHTML = SHELL;
  byId('build-time').textContent = new Date(__BUILD_TIME__).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const panel = byId('project');
  const fileInput = byId<HTMLInputElement>('file-input');
  const overlay = byId('drop-overlay');
  const copyButton = byId<HTMLButtonElement>('copy');
  const saveButton = byId<HTMLButtonElement>('save');
  const otherNote = byId<HTMLInputElement>('other-note');
  const live = byId('live');
  const out = {
    pieces: byId('res-pieces'),
    filLabel: byId('fil-label'),
    filCost: byId('fil-cost'),
    bagCost: byId('bag-cost'),
    otherRow: byId('other-cost').closest<HTMLElement>('.row')!,
    otherLabel: byId('other-label'),
    otherCost: byId('other-cost'),
    timeLabel: byId('time-label'),
    timeCost: byId('time-cost'),
    totalCost: byId('total-cost'),
    profitLabel: byId('profit-label'),
    profit: byId('profit-value'),
    note: byId('result-note'),
    price: byId('price'),
  };

  const fields = {
    kg: makeField('kg', 'money', 'Filamento (R$ por kg)'),
    bag: makeField('bag', 'money', 'Sacolinha'),
    hour: makeField('hour', 'money', 'Tempo (R$ por hora)'),
    profit: makeField('profit', 'percent', 'Lucro'),
    pieces: makeField('pieces', 'integer', PIECES_LABEL.one),
    other: makeField('other', 'money', 'Outros'),
  };
  const addons = ADDONS.map((a) => ({
    ...a,
    field: makeField(a.id, 'money', a.name),
    check: byId<HTMLInputElement>(`${a.id}-on`),
    row: byId(`${a.id}-cost`).closest<HTMLElement>('.row')!,
    cost: byId(`${a.id}-cost`),
  }));
  const allFields = [...Object.values(fields), ...addons.map((a) => a.field)];
  const piecesLabel = document.querySelector<HTMLLabelElement>('label[for="pieces"]')!;
  /** Campos que ficam salvos para o próximo projeto. */
  const savedFields: [keyof SavedValues, Field][] = [
    ['kg', fields.kg], ['bag', fields.bag], ['hour', fields.hour], ['profit', fields.profit],
    ...addons.map((a): [keyof SavedValues, Field] => [a.key, a.field]),
  ];

  /** O que vale só para a placa escolhida (ou para "Todas juntas"). */
  type PlateInputs = { pieces: string; checked: AddonKey[]; other: string; otherNote: string };
  const freshInputs = (): PlateInputs => ({ pieces: '1', checked: [], other: '', otherNote: '' });
  const readInputs = (): PlateInputs => ({
    pieces: fields.pieces.input.value,
    checked: addons.filter((a) => a.check.checked).map((a) => a.key),
    other: fields.other.input.value,
    otherNote: otherNote.value,
  });
  function writeInputs(v: PlateInputs): void {
    fields.pieces.input.value = v.pieces;
    for (const a of addons) a.check.checked = v.checked.includes(a.key);
    fields.other.input.value = v.other;
    otherNote.value = v.otherNote;
  }

  const saved = loadValues();
  for (const [key, f] of savedFields) f.input.value = saved[key];
  writeInputs(freshInputs());

  let state: PanelState = { kind: 'empty' };
  let inputsByPlate = new Map<PlateChoice, PlateInputs>();
  let priceText: string | null = null;
  let loadToken = 0;
  /** Cotação na tela, pronta para salvar; e a última salva (para não salvar a mesma duas vezes). */
  let quote: NewQuote | null = null;
  let savedQuote: { id: string; signature: string } | null = null;

  const currentPlate = () => (state.kind === 'ready' ? selectedPlate(state.project, state.plateIdx) : null);

  const historyView = mountHistory(byId('view-history'), {
    onChange: (list) => {
      byId('nav-count').textContent = list.length ? String(list.length) : '';
      if (savedQuote && !list.some((q) => q.id === savedQuote!.id)) {
        savedQuote = null;
        updateSaveButton();
      }
    },
    onSold: () => salesView.refresh(),
  });
  const salesView = mountSales(byId('view-sales'), (list) => {
    byId('nav-sales-count').textContent = list.length ? String(list.length) : '';
  });
  const summaryView = mountSummary(byId('view-summary'), {
    showPending: () => {
      salesView.showPending();
      location.hash = '#vendidos';
    },
    onRestored: () => {
      historyView.refresh();
      salesView.refresh();
      // O backup só preenche campos vazios; o que já está digitado continua.
      const restored = loadValues();
      for (const [key, f] of savedFields) if (!f.input.value.trim()) f.input.value = restored[key];
      recalc();
    },
  });

  const actions: PanelActions = {
    openPicker: () => fileInput.click(),
    pickPlate: (plateIdx) => {
      if (state.kind !== 'ready' || plateIdx === state.plateIdx) return;
      inputsByPlate.set(state.plateIdx, readInputs());
      state = { ...state, plateIdx };
      writeInputs(inputsByPlate.get(plateIdx) ?? freshInputs());
      show();
      panel.querySelector<HTMLButtonElement>(`[data-plate="${plateIdx}"]`)?.focus();
    },
  };

  function show(): void {
    renderPanel(panel, state, actions);
    // O rótulo também entra no aviso "Preencha: …".
    const label = state.kind === 'ready' && state.plateIdx === 'all' ? PIECES_LABEL.all : PIECES_LABEL.one;
    piecesLabel.textContent = label;
    fields.pieces.label = label;
    recalc();
  }

  function updateSaveButton(): void {
    // Já salva: aria-disabled em vez de disabled, para o foco do teclado não se perder.
    const alreadySaved = quote != null && savedQuote?.signature === JSON.stringify(quote);
    saveButton.disabled = quote == null;
    if (alreadySaved) saveButton.setAttribute('aria-disabled', 'true');
    else saveButton.removeAttribute('aria-disabled');
    saveButton.textContent = alreadySaved ? 'Salvo no histórico' : 'Salvar no histórico';
  }

  function clearResult(note: string): void {
    out.pieces.textContent = '';
    out.filLabel.textContent = 'Filamento';
    out.timeLabel.textContent = 'Tempo de impressão';
    out.profitLabel.textContent = 'Lucro';
    out.otherLabel.textContent = 'Outros';
    for (const a of addons) a.row.hidden = !a.check.checked;
    out.otherRow.hidden = !fields.other.input.value.trim();
    const costs = [out.filCost, out.bagCost, ...addons.map((a) => a.cost), out.otherCost, out.timeCost, out.totalCost, out.profit, out.price];
    for (const el of costs) el.textContent = '—';
    out.note.textContent = note;
    out.note.hidden = false;
    out.price.classList.add('is-empty');
    priceText = null;
    quote = null;
    copyButton.disabled = true;
    updateSaveButton();
  }

  function recalc(): void {
    for (const f of allFields) check(f);
    const plate = currentPlate();
    const used = addons.filter((a) => a.check.checked);
    // Adicional desmarcado não entra na conta e o preço dele não precisa estar preenchido. Outros vazio vale zero.
    const needed = [fields.kg, fields.bag, fields.hour, fields.profit, fields.pieces, ...used.map((a) => a.field)];
    const invalid = [...needed, fields.other].filter((f) => f.result.status === 'invalid');
    const empty = needed.filter((f) => f.result.status === 'empty');

    if (state.kind !== 'ready' || !plate) return clearResult('Abra um arquivo fatiado para ver o preço.');
    if (invalid.length) return clearResult(invalid.length === 1 ? 'Corrija o campo destacado.' : 'Corrija os campos destacados.');
    if (empty.length) return clearResult(`Preencha: ${empty.map((f) => f.label).join(', ')}.`);

    const value = (f: Field) => (f.result.status === 'ok' ? f.result.value : 0);
    const priceOf = (key: AddonKey) => {
      const addon = used.find((a) => a.key === key);
      return addon ? value(addon.field) : 0;
    };
    const pieces = value(fields.pieces);
    const other = value(fields.other);
    const note = otherNote.value.trim();
    const input = {
      pricePerKg: value(fields.kg),
      bagPrice: value(fields.bag),
      ringPrice: priceOf('ring'),
      hourPrice: value(fields.hour),
      profitPct: value(fields.profit),
    };
    const addonPrices = { pouchPrice: priceOf('pouch'), keyPouchPrice: priceOf('keyPouch'), ledPrice: priceOf('led'), otherPrice: other };
    const extras = addonPrices.pouchPrice + addonPrices.keyPouchPrice + addonPrices.ledPrice + other;
    const r = computePrice({ ...input, extras, plateGrams: plate.grams, pieces, rounding: ROUNDING, plateSeconds: plate.seconds });

    const allPlates = state.plateIdx === 'all';
    out.pieces.textContent = pieces > 1 ? `${pieces} peças ${allPlates ? 'nas placas juntas' : 'na placa'}` : '';
    out.filLabel.textContent = `Filamento (${formatGrams(r.gramsPerPiece)})`;
    out.filCost.textContent = formatBRL(r.filament);
    out.bagCost.textContent = formatBRL(r.bag);
    for (const a of addons) {
      a.row.hidden = !a.check.checked;
      a.cost.textContent = formatBRL(priceOf(a.key));
    }
    out.otherRow.hidden = other <= 0;
    out.otherLabel.textContent = note ? `Outros (${note})` : 'Outros';
    out.otherCost.textContent = formatBRL(other);
    // Tempo por peça, como as gramas: a placa inteira dividida pelas peças.
    out.timeLabel.textContent = plate.seconds ? `Tempo (${formatDuration(plate.seconds / pieces)})` : 'Tempo (o arquivo não informa)';
    out.timeCost.textContent = formatBRL(r.time);
    out.totalCost.textContent = formatBRL(r.cost);
    out.profitLabel.textContent = `Lucro (${formatPercent(input.profitPct)})`;
    out.profit.textContent = `+ ${formatBRL(r.profit)}`;
    out.note.textContent = '';
    out.note.hidden = true;

    priceText = formatBRL(r.price);
    out.price.textContent = priceText;
    out.price.classList.remove('is-empty');
    copyButton.disabled = false;

    quote = {
      ...input,
      ...addonPrices,
      ...(note && other > 0 ? { otherNote: note } : {}),
      fileName: state.project.fileName,
      plate: plate.index,
      ...(allPlates ? { plates: state.project.plates.map((p) => p.index) } : {}),
      pieces,
      gramsPerPiece: r.gramsPerPiece,
      plateSeconds: plate.seconds,
      filament: r.filament,
      time: r.time,
      cost: r.cost,
      profit: r.profit,
      price: r.price,
    };
    updateSaveButton();
  }

  function persist(): void {
    const next = loadValues();
    for (const [key, f] of savedFields) {
      if (f.result.status !== 'invalid') next[key] = f.input.value.trim();
    }
    saveValues(next);
  }

  for (const f of allFields) {
    f.input.addEventListener('input', () => {
      recalc();
      persist();
    });
    f.input.addEventListener('blur', () => {
      // Deixa o número no formato brasileiro: "120" → "120,00".
      if (f.result.status === 'ok') {
        const formatted = formatInput(f.result.value, f.kind);
        if (formatted !== f.input.value) {
          f.input.value = formatted;
          f.input.dispatchEvent(new Event('input'));
        }
      }
    });
  }

  for (const a of addons) a.check.addEventListener('change', recalc);
  // A descrição vai junto na cotação: mudar o texto permite salvar de novo.
  otherNote.addEventListener('input', recalc);

  copyButton.addEventListener('click', async () => {
    if (!priceText) return;
    const ok = await copyText(priceText);
    copyButton.textContent = ok ? 'Copiado!' : 'Não consegui copiar';
    live.textContent = ok ? `Preço copiado: ${priceText}` : 'Não consegui copiar o preço.';
    window.setTimeout(() => {
      copyButton.textContent = 'Copiar preço';
    }, 1800);
  });

  saveButton.addEventListener('click', () => {
    if (!quote || saveButton.getAttribute('aria-disabled') === 'true') return;
    const entry = addQuote(quote);
    if (!entry) {
      saveButton.textContent = 'Não consegui salvar';
      live.textContent = 'Não consegui salvar no histórico. O navegador pode estar bloqueando o armazenamento.';
      window.setTimeout(updateSaveButton, 2500);
      return;
    }
    savedQuote = { id: entry.id, signature: JSON.stringify(quote) };
    historyView.refresh();
    updateSaveButton();
    live.textContent = `Cotação salva no histórico: ${formatBRL(entry.price)}.`;
  });

  // Navegação por hash (#resumo, #calculadora...): funciona em file:// e o botão Voltar do navegador acompanha.
  const views = { summary: byId('view-summary'), calc: byId('view-calc'), history: byId('view-history'), sales: byId('view-sales') };
  const navLinks = { summary: byId('nav-summary'), calc: byId('nav-calc'), history: byId('nav-history'), sales: byId('nav-sales') };
  const lists = { summary: summaryView, history: historyView, sales: salesView };
  type View = keyof typeof views;
  const HASHES: Record<string, View> = { '#resumo': 'summary', '#calculadora': 'calc', '#historico': 'history', '#vendidos': 'sales' };

  // Sem hash (ou um desconhecido), abre no Resumo.
  const currentView = (): View => HASHES[location.hash] ?? 'summary';

  function route(moveFocus: boolean): void {
    const current = currentView();
    for (const name of Object.keys(views) as View[]) {
      views[name].hidden = name !== current;
      if (name === current) navLinks[name].setAttribute('aria-current', 'page');
      else navLinks[name].removeAttribute('aria-current');
    }
    // Lê de novo ao entrar: a outra lista (ou outra aba) pode ter mudado algo.
    if (current !== 'calc') lists[current].refresh();
    if (!moveFocus) return;
    if (current !== 'calc') return lists[current].focusTitle();
    const title = byId('proj-title');
    title.setAttribute('tabindex', '-1');
    title.focus();
  }

  window.addEventListener('hashchange', () => route(true));
  route(false);

  async function openFile(file: File): Promise<void> {
    const token = ++loadToken;
    if (currentView() !== 'calc') location.hash = '#calculadora';
    if (!/\.(3mf|gcode)$/i.test(file.name)) {
      state = { kind: 'error', fileName: file.name, message: INVALID_FILE_MESSAGE, notSliced: false };
      return show();
    }

    state = { kind: 'loading', fileName: file.name };
    show();
    try {
      const project = await parseFile(file, file.name);
      if (token !== loadToken) return;
      state = { kind: 'ready', project, plateIdx: 0, loadedAt: new Date() };
      // Arquivo novo começa sem adicionais e sem Outros: evita somar argola num porta-copos depois de um chaveiro.
      inputsByPlate = new Map();
      writeInputs(freshInputs());
      savedQuote = null;
      live.textContent = `${file.name} carregado.`;
    } catch (e) {
      if (token !== loadToken) return;
      const notSliced = e instanceof ParseError && e.code === 'not-sliced';
      const message = e instanceof ParseError ? e.message : INVALID_FILE_MESSAGE;
      state = { kind: 'error', fileName: file.name, message, notSliced };
      if (!(e instanceof ParseError)) console.error(e);
    }
    show();
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // permite reabrir o mesmo arquivo
    if (file) void openFile(file);
  });

  // Arrastar e soltar em qualquer lugar da janela.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  let dragDepth = 0;
  const setDragging = (on: boolean) => overlay.classList.toggle('show', on);

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    setDragging(true);
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragging(false);
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    setDragging(false);
    const file = e.dataTransfer?.files[0];
    if (file) void openFile(file);
  });

  show();
}
