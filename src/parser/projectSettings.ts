/** Dados por slot de filamento (índice 0 = slot 1). */
export type SlotSettings = {
  /** R$/kg do perfil; 0 quando ausente/inválido. */
  costs: number[];
  /** Nome curto do perfil; '' quando ausente. */
  profiles: string[];
};

/** "Bambu PLA Matte @BBL A1M" → "PLA Matte". Perfis de outras marcas ficam com o nome inteiro. */
export function profileLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\s*@.*$/, '')
    .replace(/^Bambu\s+/i, '')
    .trim();
}

function parseCost(value: unknown): number {
  const n = Number.parseFloat(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Aceita array (JSON do Bambu Studio) ou texto separado por ';'. */
function list(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw).split(';');
  return [];
}

/**
 * Lê Metadata/project_settings.config (JSON). O Bambu Studio grava um item por slot:
 *   "filament_cost": ["19.99", "21.99"], "filament_settings_id": ["Bambu PLA Matte @BBL A1M", ...]
 */
export function parseProjectSettings(json: string): SlotSettings {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { costs: [], profiles: [] };
  }
  if (typeof data !== 'object' || data === null) return { costs: [], profiles: [] };

  const settings = data as Record<string, unknown>;
  return {
    costs: list(settings['filament_cost']).map(parseCost),
    profiles: list(settings['filament_settings_id']).map(profileLabel),
  };
}
