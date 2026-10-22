import { normalizeHex } from '../calc/color';
import { round2 } from '../calc/number';
import type { Filament } from './types';

/** Placa como aparece no slice_info.config; gramas/tempo podem faltar. */
export type SliceInfoPlate = {
  index: number;
  grams: number | null;
  seconds: number | null;
  filaments: Filament[];
};

function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}

export function toNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(value.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function positive(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

/**
 * Lê Metadata/slice_info.config. Formato do Bambu Studio:
 *   <plate>
 *     <metadata key="index" value="1"/>
 *     <metadata key="prediction" value="8040"/>   (segundos)
 *     <metadata key="weight" value="48.60"/>      (gramas)
 *     <filament id="1" type="PLA" color="#000000" used_m="16.1" used_g="48.60"/>
 *   </plate>
 * Retorna null se o XML estiver corrompido.
 */
export function parseSliceInfo(xml: string): SliceInfoPlate[] | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  return Array.from(doc.getElementsByTagName('plate')).map((plateEl, i) => {
    const meta = new Map<string, string>();
    for (const m of children(plateEl, 'metadata')) {
      const key = m.getAttribute('key');
      if (key) meta.set(key, m.getAttribute('value') ?? '');
    }

    const filaments: Filament[] = children(plateEl, 'filament').map((f, j) => ({
      slot: toNumber(f.getAttribute('id')) ?? j + 1,
      type: (f.getAttribute('type') ?? '').trim(),
      color: normalizeHex(f.getAttribute('color')),
      grams: positive(toNumber(f.getAttribute('used_g'))) ?? 0,
    }));

    const filamentSum = round2(filaments.reduce((sum, f) => sum + f.grams, 0));

    return {
      index: toNumber(meta.get('index')) ?? i + 1,
      grams: positive(toNumber(meta.get('weight'))) ?? positive(filamentSum),
      seconds: positive(toNumber(meta.get('prediction'))),
      filaments,
    };
  });
}
