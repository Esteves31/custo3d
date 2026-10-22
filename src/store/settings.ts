/** Valores que a pessoa digitou, guardados como texto para voltarem iguais. */
export type SavedValues = {
  kg: string;
  bag: string;
  ring: string;
  hour: string;
  profit: string;
};

// Campos novos entram sem trocar a chave: o que falta no JSON antigo volta vazio.
const KEY = 'custo3d:valores:v1';
const EMPTY: SavedValues = { kg: '', bag: '', ring: '', hour: '', profit: '' };

// localStorage pode lançar exceção (modo privado, armazenamento bloqueado): o app segue sem salvar.

/** Lê qualquer objeto (do localStorage ou de um backup) como valores; o que não for texto volta vazio. */
export function toSavedValues(data: unknown): SavedValues {
  const d = (typeof data === 'object' && data != null ? data : {}) as Partial<Record<keyof SavedValues, unknown>>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return { kg: str(d.kg), bag: str(d.bag), ring: str(d.ring), hour: str(d.hour), profit: str(d.profit) };
}

export function loadValues(): SavedValues {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? toSavedValues(JSON.parse(raw)) : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** false quando não há armazenamento disponível. */
export function saveValues(values: SavedValues): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(values));
    return true;
  } catch {
    return false;
  }
}
