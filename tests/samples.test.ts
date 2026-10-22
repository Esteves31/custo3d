import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFile, ParseError, type SlicedProject } from '../src/parser';

/** Valores conferidos à mão nos arquivos reais (ver comentários no G-code / slice_info). */
const KNOWN: Record<string, (project: SlicedProject) => void> = {
  'coaster_PLA_55m33s.gcode': ({ plates }) => {
    expect(plates).toHaveLength(1);
    expect(plates[0]).toMatchObject({ index: 1, grams: 18.05, seconds: 3333 });
    expect(plates[0]!.filaments.map((f) => [f.slot, f.profile, f.color, f.grams])).toEqual([
      [1, 'PLA Matte', '#000000', 13.16],
      [2, 'PLA Basic', '#E5B03D', 1.53],
      [3, 'PLA Matte', '#FFFFFF', 1.78],
      [4, 'PLA Basic', '#4D3324', 1.58],
    ]);
  },
};
const KNOWN_NOT_SLICED = ['Jolteon_cute_coaster.3mf'];

/**
 * Roda o parser em cada arquivo real de samples/.
 * .gcode.3mf e .gcode precisam gerar placas com gramas; .3mf de projeto pode ser "não fatiado".
 */
const dir = resolve(__dirname, '..', 'samples');
const files = readdirSync(dir).filter((f) => /\.(3mf|gcode)$/i.test(f));

describe.skipIf(files.length === 0)('arquivos reais em samples/', () => {
  it.each(files)('%s', async (name) => {
    const data = new Blob([readFileSync(join(dir, name))]);
    const sliced = /\.gcode(\.3mf)?$/i.test(name);

    let project: SlicedProject;
    try {
      project = await parseFile(data, name);
    } catch (e) {
      if (sliced || !(e instanceof ParseError)) throw e;
      expect(e.code).toBe('not-sliced');
      return;
    }

    expect(KNOWN_NOT_SLICED).not.toContain(name);
    expect(project.plates.length).toBeGreaterThan(0);
    for (const plate of project.plates) {
      expect(plate.grams).toBeGreaterThan(0);
      expect(plate.filaments.length).toBeGreaterThan(0);
    }
    KNOWN[name]?.(project);
  });
});

it.skipIf(files.length > 0)('samples/ vazio — coloque arquivos reais para validar o parser', () => {});
