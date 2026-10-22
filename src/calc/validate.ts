import { parseNumber } from './number';

export type FieldKind = 'money' | 'percent' | 'integer';

export type FieldResult =
  | { status: 'ok'; value: number }
  | { status: 'empty' }
  | { status: 'invalid'; message: string };

const EXAMPLES: Record<FieldKind, string> = {
  money: 'Valor inválido. Exemplo: 120,00',
  percent: 'Valor inválido. Exemplo: 150',
  integer: 'Use um número inteiro, como 1 ou 4.',
};

export function validateField(raw: string, kind: FieldKind): FieldResult {
  if (raw.trim() === '') return { status: 'empty' };
  const value = parseNumber(raw);
  if (value == null) return { status: 'invalid', message: EXAMPLES[kind] };
  if (value < 0) return { status: 'invalid', message: 'O valor não pode ser negativo.' };
  if (kind === 'integer' && (!Number.isInteger(value) || value < 1)) {
    return { status: 'invalid', message: 'Use um número inteiro a partir de 1.' };
  }
  return { status: 'ok', value };
}
