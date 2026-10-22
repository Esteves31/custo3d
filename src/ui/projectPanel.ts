import { colorName } from '../calc/color';
import { formatDuration, formatGrams } from '../calc/format';
import type { Filament, Plate, SlicedProject } from '../parser';
import { h, icon, ICONS } from './dom';

export type PanelState =
  | { kind: 'empty' }
  | { kind: 'loading'; fileName: string }
  | { kind: 'error'; fileName: string; message: string; notSliced: boolean }
  | { kind: 'ready'; project: SlicedProject; plateIdx: number; loadedAt: Date };

export type PanelActions = {
  openPicker: () => void;
  pickPlate: (plateIdx: number) => void;
};

const EXPORT_PATH = 'Arquivo › Exportar › Exportar arquivo fatiado da placa';

export function renderPanel(root: HTMLElement, state: PanelState, actions: PanelActions): void {
  switch (state.kind) {
    case 'empty':
      root.replaceChildren(dropzone(actions));
      break;
    case 'loading':
      root.replaceChildren(
        h('div', { class: 'loading', role: 'status' },
          h('span', { class: 'spinner', 'aria-hidden': 'true' }),
          h('h1', { id: 'proj-title', class: 'drop-title' }, 'Lendo arquivo…'),
          h('p', { class: 'muted file-name' }, state.fileName),
        ),
      );
      break;
    case 'error':
      root.replaceChildren(errorAlert(state), dropzone(actions));
      break;
    case 'ready':
      root.replaceChildren(...projectView(state, actions));
      break;
  }
}

function dropzone(actions: PanelActions): HTMLElement {
  return h('div', { class: 'dropzone' },
    icon(ICONS.upload),
    h('h1', { id: 'proj-title', class: 'drop-title' }, 'Arraste aqui o arquivo fatiado'),
    h('p', { class: 'drop-sub' }, 'Arquivo ', h('strong', null, '.gcode.3mf'), ' ou ', h('strong', null, '.gcode'), ' exportado pelo Bambu Studio'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: actions.openPicker }, 'Abrir arquivo'),
    h('p', { class: 'drop-help' }, 'No Bambu Studio, depois de fatiar, use ', h('strong', null, EXPORT_PATH), '. O .3mf de projeto não serve.'),
  );
}

function errorAlert(state: Extract<PanelState, { kind: 'error' }>): HTMLElement {
  const message = state.notSliced
    ? [
        h('p', null, 'Este é o arquivo de ', h('strong', null, 'projeto'), ' do Bambu Studio. Ele não guarda o peso nem o tempo de impressão, mesmo depois de fatiar.'),
        h('p', null, 'No Bambu Studio, fatie e use ', h('em', null, 'Exportar arquivo fatiado da placa'), '. Isso gera um arquivo ', h('strong', null, '.gcode.3mf'), ' (o Windows pode mostrar só ', h('strong', null, '.gcode'), '), que é o que a calculadora lê.'),
      ]
    : [h('p', null, state.message)];
  return h('div', { class: 'alert', role: 'alert' },
    icon(ICONS.alert),
    h('div', null, h('strong', { class: 'file-name' }, state.fileName), ...message),
  );
}

function projectView(state: Extract<PanelState, { kind: 'ready' }>, actions: PanelActions): HTMLElement[] {
  const { project, plateIdx, loadedAt } = state;
  const plate = project.plates[plateIdx]!;
  const time = loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const count = project.plates.length;

  const head = h('div', { class: 'project-head' },
    h('div', { class: 'project-id' },
      h('span', { class: 'eyebrow' }, 'Projeto carregado'),
      h('h1', { id: 'proj-title', class: 'project-title' }, project.fileName),
      h('span', { class: 'muted small' }, `Aberto às ${time}`),
    ),
    h('span', { class: 'badge-ok' }, 'Fatiado'),
  );

  const plates = h('div', { class: 'plates', role: 'group', 'aria-labelledby': 'plates-label' },
    h('span', { id: 'plates-label', class: 'field-label' }, count > 1 ? `Placa (${count} no arquivo)` : 'Placa'),
    h('div', { class: 'chips' },
      ...project.plates.map((p, i) =>
        h('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': i === plateIdx ? 'true' : 'false',
          'data-plate': i,
          onclick: () => actions.pickPlate(i),
        }, `Placa ${p.index}`),
      ),
    ),
  );

  const stats = h('div', { class: 'stats' },
    tile('Filamento usado', h('span', { class: 'stat-number' }, formatGrams(plate.grams))),
    tile('Tempo de impressão', h('span', { class: 'stat-number' }, formatDuration(plate.seconds))),
    tile('Material', h('span', { class: 'stat-text' }, materials(plate))),
    tile('Cor', colors(plate)),
  );

  const parts: HTMLElement[] = [head, plates, stats];
  if (plate.filaments.length > 1) parts.push(filamentList(plate.filaments));

  parts.push(
    h('div', { class: 'project-foot' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: actions.openPicker }, icon(ICONS.file), 'Abrir outro arquivo'),
      h('span', { class: 'muted small' }, 'ou arraste outro arquivo para a janela'),
    ),
  );
  return parts;
}

function tile(label: string, value: HTMLElement): HTMLElement {
  return h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), value);
}

/** "PLA Matte" quando o arquivo traz o perfil; senão só o tipo ("PLA"). */
const materialName = (f: Filament) => f.profile || f.type;

function materials(plate: Plate): string {
  const names = [...new Set(plate.filaments.map(materialName).filter(Boolean))];
  return names.length ? names.join(' + ') : '—';
}

function swatch(color: string): HTMLElement {
  const el = h('span', { class: 'swatch', 'aria-hidden': 'true' });
  if (/^#[0-9A-F]{6}$/i.test(color)) el.style.background = color;
  return el;
}

function colors(plate: Plate): HTMLElement {
  const unique = [...new Set(plate.filaments.map((f) => f.color).filter(Boolean))];
  if (unique.length === 0) return h('span', { class: 'stat-text' }, '—');
  return h('span', { class: 'stat-text colors' },
    ...unique.map((c) => h('span', { class: 'color', title: c }, swatch(c), colorName(c) || c)),
  );
}

function filamentList(filaments: Filament[]): HTMLElement {
  return h('div', { class: 'filaments' },
    h('span', { class: 'field-label', id: 'fil-list-label' }, 'Por filamento'),
    h('ul', { 'aria-labelledby': 'fil-list-label' },
      ...filaments.map((f) =>
        h('li', null,
          swatch(f.color),
          h('span', { class: 'filament-name' }, [materialName(f), colorName(f.color)].filter(Boolean).join(' · ')),
          h('span', { class: 'mono' }, formatGrams(f.grams)),
        ),
      ),
    ),
  );
}
