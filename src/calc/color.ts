/**
 * Normaliza cores vindas do Bambu Studio para #RRGGBB maiúsculo.
 * Aceita #RGB, #RRGGBB e #RRGGBBAA (o alfa é descartado). Retorna '' se inválida.
 */
export function normalizeHex(value: string | null | undefined): string {
  const raw = (value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return ('#' + raw.split('').map((c) => c + c).join('')).toUpperCase();
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) {
    return ('#' + raw.slice(0, 6)).toUpperCase();
  }
  return '';
}

const NAMED_COLORS: [name: string, hex: string][] = [
  ['Preto', '#000000'],
  ['Branco', '#FFFFFF'],
  ['Grafite', '#333333'],
  ['Cinza-escuro', '#4B4B4B'],
  ['Cinza', '#8E8E8E'],
  ['Cinza-claro', '#C8C8C8'],
  ['Vermelho', '#C62828'],
  ['Bordô', '#7B1E2B'],
  ['Laranja', '#F57C00'],
  ['Amarelo', '#FDD835'],
  ['Dourado', '#C9A227'],
  ['Bege', '#E3CBA8'],
  ['Marrom', '#6D4C41'],
  ['Marrom-escuro', '#4E342E'],
  ['Verde', '#2E7D32'],
  ['Verde-claro', '#8BC34A'],
  ['Turquesa', '#26A69A'],
  ['Ciano', '#00BCD4'],
  ['Azul-claro', '#64B5F6'],
  ['Azul', '#1565C0'],
  ['Azul-marinho', '#1A237E'],
  ['Roxo', '#6A1B9A'],
  ['Lilás', '#B39DDB'],
  ['Rosa', '#F48FB1'],
  ['Magenta', '#D81B60'],
];

function toRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Nome aproximado da cor em português (cor nomeada mais próxima). */
export function colorName(value: string): string {
  const hex = normalizeHex(value);
  if (!hex) return '';
  const [r, g, b] = toRgb(hex);
  let best = '';
  let bestDistance = Infinity;
  for (const [name, ref] of NAMED_COLORS) {
    const [r2, g2, b2] = toRgb(ref);
    // Distância "redmean": aproximação barata da percepção humana.
    const rm = (r + r2) / 2;
    const d = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = name;
    }
  }
  return best;
}
