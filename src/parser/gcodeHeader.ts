import { normalizeHex } from '../calc/color';
import { round2 } from '../calc/number';
import { profileLabel } from './projectSettings';

export type GcodeInfo = {
  /** Gramas por filamento usado, na ordem de `usedSlots` quando o cabeçalho traz essa linha. */
  gramsList: number[];
  grams: number | null;
  seconds: number | null;
  /** Slots que a placa usa (linha "; filament: 1,2,3,4"). */
  usedSlots: number[];
  /** Listas por slot, vindas do bloco de configuração. */
  types: string[];
  colors: string[];
  costs: number[];
  profiles: string[];
};

function findLine(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? null;
}

function numberList(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** "1d 2h 14m 5s" → segundos. Retorna null se não houver nenhuma unidade. */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const factors: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  let found = false;
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])\b/gi)) {
    total += Number.parseFloat(amount!) * factors[unit!.toLowerCase()]!;
    found = true;
  }
  return found ? Math.round(total) : null;
}

/**
 * Lê os comentários do G-code do Bambu Studio (e variantes Orca/Prusa). Exemplo real (2.08):
 *   ; model printing time: 49m 25s; total estimated time: 55m 33s
 *   ; total filament weight [g] : 13.16,1.53,1.78,1.58
 *   ; filament: 1,2,3,4
 *   ; filament_colour = #000000;#E5B03D;#FFFFFF;#4D3324
 *   ; filament_cost = 19.99,19.99,19.99,19.99
 *   ; filament_settings_id = "Bambu PLA Matte @BBL A1M";"Bambu PLA Basic @BBL A1M";...
 *   ; filament_type = PLA;PLA;PLA;PLA
 */
export function parseGcodeHeader(text: string): GcodeInfo {
  const weightLine =
    findLine(text, /^;\s*total filament weight \[g\]\s*[:=]\s*(.+)$/im) ??
    findLine(text, /^;\s*filament used \[g\]\s*[:=]\s*(.+)$/im);
  const gramsList = numberList(weightLine).filter((g) => g >= 0);
  const gramsTotal = round2(gramsList.reduce((sum, g) => sum + g, 0));

  const timeText =
    findLine(text, /^;.*total estimated time\s*[:=]\s*([^;\r\n]+)/im) ??
    findLine(text, /^;\s*estimated printing time[^:=\r\n]*[:=]\s*([^;\r\n]+)/im) ??
    findLine(text, /^;.*model printing time\s*[:=]\s*([^;\r\n]+)/im);
  const seconds = parseDuration(timeText);

  const split = (line: string | null) => (line ? line.split(';').map((s) => s.trim()) : []);

  return {
    gramsList,
    grams: gramsTotal > 0 ? gramsTotal : null,
    seconds: seconds && seconds > 0 ? seconds : null,
    usedSlots: numberList(findLine(text, /^;\s*filament:\s*(.+)$/im)).map(Math.round),
    types: split(findLine(text, /^;\s*filament_type\s*=\s*(.+)$/im)),
    colors: split(findLine(text, /^;\s*filament_colou?r\s*=\s*(.+)$/im)).map(normalizeHex),
    costs: numberList(findLine(text, /^;\s*filament_cost\s*=\s*(.+)$/im)),
    profiles: split(findLine(text, /^;\s*filament_settings_id\s*=\s*(.+)$/im)).map(profileLabel),
  };
}
