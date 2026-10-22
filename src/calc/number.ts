/**
 * Arredonda para 2 casas (meio para cima) sem ruído de ponto flutuante.
 * `toPrecision(12)` limpa o resíduo antes do Math.round: 2.135 * 100 = 213.49999999999997,
 * que viraria 2,13; somar gramas dá 18.049999999999997 em vez de 18,05.
 * (`+ Number.EPSILON` não resolve: é pequeno demais perto de valores acima de ~2.)
 */
export function round2(value: number): number {
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

/**
 * Converte o que a pessoa digitou em número. Aceita formato brasileiro e o com ponto:
 *   "120,00" → 120 · "120.5" → 120.5 · "1.234,56" → 1234.56 · "0,35" → 0.35 · "R$ 12" → 12 · "150%" → 150
 * Retorna null para vazio ou inválido.
 */
export function parseNumber(input: string): number | null {
  let s = input.trim().replace(/^R\$/i, '').replace(/%$/, '').replace(/\s+/g, '');
  if (s === '') return null;

  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // O último separador é o decimal; o outro é de milhar.
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    const [intPart, fracPart, ...rest] = s.split(decimal);
    if (rest.length > 0 || fracPart === undefined || fracPart.includes(thousands)) return null;
    if (!/^\d{1,3}([.,]\d{3})*$/.test(intPart!)) return null;
    s = intPart!.split(thousands).join('') + '.' + fracPart;
  } else if (lastComma >= 0) {
    if (s.indexOf(',') !== lastComma) return null;
    s = s.replace(',', '.');
  } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
    // Vários pontos só fazem sentido como milhar: "1.234.567".
    if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
    s = s.split('.').join('');
  }

  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const value = Number.parseFloat(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
