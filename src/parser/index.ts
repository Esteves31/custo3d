import JSZip from 'jszip';
import { invalidFile, notSliced } from './errors';
import { parseGcodeHeader, type GcodeInfo } from './gcodeHeader';
import { parseProjectSettings, type SlotSettings } from './projectSettings';
import { parseSliceInfo } from './sliceInfo';
import type { Filament, Plate, SlicedProject } from './types';

export { ParseError, NOT_SLICED_MESSAGE, INVALID_FILE_MESSAGE } from './errors';
export type { Filament, Plate, SlicedProject } from './types';

export type ZipInput = Blob | ArrayBuffer | Uint8Array;

type ZipEntry = JSZip.JSZipObject;

function findEntry(zip: JSZip, path: string): ZipEntry | null {
  const lower = path.toLowerCase();
  const key = Object.keys(zip.files).find((k) => k.toLowerCase() === lower);
  return key ? zip.file(key) : null;
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const entry = findEntry(zip, path);
  return entry ? entry.async('string') : null;
}

function gcodeEntries(zip: JSZip): Map<number, ZipEntry> {
  const entries = new Map<number, ZipEntry>();
  zip.forEach((path, entry) => {
    const match = /^metadata\/plate_(\d+)\.gcode$/i.exec(path);
    if (match && !entry.dir) entries.set(Number(match[1]), entry);
  });
  return entries;
}

function looksLike3mf(zip: JSZip): boolean {
  return Object.keys(zip.files).some((k) => /^(\[content_types\]\.xml|3d\/|metadata\/)/i.test(k));
}

/** O cabeçalho do G-code só permite montar filamentos quando o mapeamento é inequívoco. */
function filamentsFromGcode(info: GcodeInfo): Filament[] {
  const { types, colors, gramsList, grams, usedSlots } = info;
  // "; filament: 1,3" diz a que slot cada peso se refere — vale mesmo com slots sem uso.
  if (usedSlots.length > 0 && usedSlots.length === gramsList.length) {
    return usedSlots
      .map((slot, i) => ({ slot, type: types[slot - 1] ?? '', color: colors[slot - 1] ?? '', grams: gramsList[i]! }))
      .filter((f) => f.grams > 0);
  }
  if (types.length === 1) {
    return [{ slot: 1, type: types[0]!, color: colors[0] ?? '', grams: grams ?? 0 }];
  }
  if (types.length > 1 && gramsList.length === types.length) {
    return types
      .map((type, i) => ({ slot: i + 1, type, color: colors[i] ?? '', grams: gramsList[i]! }))
      .filter((f) => f.grams > 0);
  }
  return [];
}

/** Filamento com mais gramas na placa: é o que define material e preço. */
export function mainFilament(plate: Plate): Filament | undefined {
  return plate.filaments.reduce<Filament | undefined>((best, f) => (!best || f.grams > best.grams ? f : best), undefined);
}

/** Preenche nome do perfil e R$/kg (por slot) nos filamentos e no projeto. */
function withSlotInfo(project: SlicedProject, { costs, profiles }: SlotSettings): SlicedProject {
  for (const plate of project.plates) {
    for (const f of plate.filaments) {
      const profile = profiles[f.slot - 1];
      if (profile) f.profile = profile;
      const cost = costs[f.slot - 1];
      if (cost && cost > 0) f.pricePerKg = cost;
    }
  }
  const price = mainFilament(project.plates[0]!)?.pricePerKg;
  if (price) project.filamentPricePerKg = price;
  return project;
}

/** Cabeçalho e bloco de configuração ficam nas pontas do .gcode, que pode ter dezenas de MB. */
const GCODE_EDGE_BYTES = 1024 * 1024;

export async function readGcodeText(file: Blob): Promise<string> {
  if (file.size <= 2 * GCODE_EDGE_BYTES) return file.text();
  const [head, tail] = await Promise.all([
    file.slice(0, GCODE_EDGE_BYTES).text(),
    file.slice(file.size - GCODE_EDGE_BYTES).text(),
  ]);
  return `${head}\n${tail}`;
}

/** .gcode solto, sem o .3mf em volta: uma placa, dados só do cabeçalho. */
export function parseGcodeText(text: string, fileName: string): SlicedProject {
  const info = parseGcodeHeader(text);
  if (info.grams == null) throw invalidFile();
  const index = Number(/plate_(\d+)/i.exec(fileName)?.[1] ?? 1);
  const plate: Plate = { index, grams: info.grams, seconds: info.seconds, filaments: filamentsFromGcode(info) };
  return withSlotInfo({ fileName, plates: [plate] }, info);
}

/** Escolhe o leitor pela extensão: .gcode solto ou .gcode.3mf (ZIP). */
export async function parseFile(file: Blob, fileName: string): Promise<SlicedProject> {
  if (/\.gcode$/i.test(fileName)) return parseGcodeText(await readGcodeText(file), fileName);
  return parseSlicedFile(file, fileName);
}

/**
 * Lê um .gcode.3mf do Bambu Studio.
 * Fonte principal: Metadata/slice_info.config. Reserva: cabeçalho de Metadata/plate_N.gcode.
 * Lança ParseError('not-sliced') para .3mf sem fatiamento e ParseError('invalid-file') para o resto.
 */
export async function parseSlicedFile(input: ZipInput, fileName: string): Promise<SlicedProject> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw invalidFile();
  }

  const sliceInfoXml = await readText(zip, 'Metadata/slice_info.config');
  const sliceInfo = (sliceInfoXml && parseSliceInfo(sliceInfoXml)) || [];
  const settingsJson = await readText(zip, 'Metadata/project_settings.config');
  const slots: SlotSettings = settingsJson ? parseProjectSettings(settingsJson) : { costs: [], profiles: [] };

  const gcodes = gcodeEntries(zip);
  const gcodeCache = new Map<number, GcodeInfo | null>();
  const readGcode = async (index: number): Promise<GcodeInfo | null> => {
    if (!gcodeCache.has(index)) {
      const entry = gcodes.get(index);
      const info = entry ? parseGcodeHeader(await entry.async('string')) : null;
      if (info && slots.costs.length === 0) slots.costs = info.costs;
      if (info && slots.profiles.length === 0) slots.profiles = info.profiles;
      gcodeCache.set(index, info);
    }
    return gcodeCache.get(index) ?? null;
  };

  const plates = new Map<number, Plate>();

  for (const p of sliceInfo) {
    let { grams, seconds, filaments } = p;
    if (grams == null || seconds == null || filaments.length === 0) {
      const info = await readGcode(p.index);
      if (info) {
        grams ??= info.grams;
        seconds ??= info.seconds;
        if (filaments.length === 0) filaments = filamentsFromGcode(info);
      }
    }
    if (grams != null) plates.set(p.index, { index: p.index, grams, seconds, filaments });
  }

  // Placas que só existem como G-code (slice_info ausente ou incompleto).
  for (const index of gcodes.keys()) {
    if (plates.has(index) || gcodeCache.has(index)) continue;
    const info = await readGcode(index);
    if (info?.grams != null) {
      plates.set(index, { index, grams: info.grams, seconds: info.seconds, filaments: filamentsFromGcode(info) });
    }
  }

  if (plates.size === 0) {
    throw looksLike3mf(zip) ? notSliced() : invalidFile();
  }

  const sorted = [...plates.values()].sort((a, b) => a.index - b.index);
  return withSlotInfo({ fileName, plates: sorted }, slots);
}
