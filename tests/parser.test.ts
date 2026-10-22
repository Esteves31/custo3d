import { describe, expect, it } from 'vitest';
import { mainFilament, parseFile, parseGcodeText, parseSlicedFile, readGcodeText, ParseError, NOT_SLICED_MESSAGE } from '../src/parser';
import { parseDuration, parseGcodeHeader } from '../src/parser/gcodeHeader';
import { parseProjectSettings, profileLabel } from '../src/parser/projectSettings';
import { parseSliceInfo } from '../src/parser/sliceInfo';
import * as fx from './fixtures';

async function parseError(promise: Promise<unknown>): Promise<ParseError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError);
    return e as ParseError;
  }
  throw new Error('esperava ParseError');
}

describe('parseSlicedFile', () => {
  it('lê um arquivo com várias placas e vários filamentos', async () => {
    const project = await parseSlicedFile(await fx.multiPlate(), 'suporte_fone_v2.gcode.3mf');

    expect(project.fileName).toBe('suporte_fone_v2.gcode.3mf');
    expect(project.plates).toHaveLength(2);

    const [p1, p2] = project.plates;
    expect(p1).toMatchObject({ index: 1, grams: 48.6, seconds: 8040 });
    expect(p1!.filaments).toEqual([{ slot: 1, type: 'PLA', color: '#000000', grams: 48.6, profile: 'PLA Basic', pricePerKg: 120 }]);

    expect(p2).toMatchObject({ index: 2, grams: 22.1, seconds: 3900 });
    expect(p2!.filaments).toEqual([
      { slot: 2, type: 'PLA', color: '#FFFFFF', grams: 15, profile: 'PLA Basic' },
      { slot: 3, type: 'PETG', color: '#C12E1F', grams: 7.1, profile: 'Generic PETG', pricePerKg: 95.5 },
    ]);

    expect(project.filamentPricePerKg).toBe(120);
  });

  it('mantém o número original da placa exportada sozinha', async () => {
    const project = await parseSlicedFile(await fx.singlePlateExport(), 'placa3.gcode.3mf');
    expect(project.plates).toHaveLength(1);
    expect(project.plates[0]).toMatchObject({ index: 3, grams: 12.34, seconds: 2700 });
    expect(project.filamentPricePerKg).toBeUndefined();
  });

  it('usa o cabeçalho do G-code quando o slice_info não tem os dados', async () => {
    const project = await parseSlicedFile(await fx.gcodeFallback(), 'x.gcode.3mf');
    expect(project.plates).toHaveLength(1);
    expect(project.plates[0]).toMatchObject({ index: 1, grams: 17.38, seconds: 5725 });
    expect(project.plates[0]!.filaments).toEqual([{ slot: 1, type: 'PLA', color: '#FFFFFF', grams: 17.38, pricePerKg: 89.9 }]);
  });

  it('usa o G-code quando o slice_info está corrompido', async () => {
    const project = await parseSlicedFile(await fx.corruptSliceInfo(), 'x.gcode.3mf');
    expect(project.plates[0]).toMatchObject({ index: 1, grams: 30.5, seconds: 93784 });
    expect(project.plates[0]!.filaments[0]).toMatchObject({ type: 'ABS', color: '#F57C00' });
  });

  it('avisa quando o .3mf ainda não foi fatiado', async () => {
    const err = await parseError(parseSlicedFile(await fx.unsliced(), 'projeto.3mf'));
    expect(err.code).toBe('not-sliced');
    expect(err.message).toBe(NOT_SLICED_MESSAGE);
  });

  it('rejeita arquivo que não é ZIP', async () => {
    const err = await parseError(parseSlicedFile(new TextEncoder().encode('isto não é um zip'), 'foto.jpg'));
    expect(err.code).toBe('invalid-file');
  });

  it('rejeita ZIP que não é .3mf', async () => {
    const err = await parseError(parseSlicedFile(await fx.randomZip(), 'coisa.zip'));
    expect(err.code).toBe('invalid-file');
  });
});

describe('.gcode solto', () => {
  const gcode = fx.gcodeText({ weight: '48.60', model: '2h 8m 36s', total: '2h 14m 0s', types: 'PLA', colors: '#000000', costs: '120' });

  it('lê peso, tempo e filamento do cabeçalho', () => {
    const project = parseGcodeText(gcode, 'Jolteon_plate_2.gcode');
    expect(project.plates).toEqual([
      { index: 2, grams: 48.6, seconds: 8040, filaments: [{ slot: 1, type: 'PLA', color: '#000000', grams: 48.6, pricePerKg: 120 }] },
    ]);
    expect(project.filamentPricePerKg).toBe(120);
  });

  it('usa placa 1 quando o nome não diz', () => {
    expect(parseGcodeText(gcode, 'peca.gcode').plates[0]!.index).toBe(1);
  });

  it('separa gramas por filamento quando o cabeçalho lista todos os slots', () => {
    const multi = fx.gcodeText({
      weight: '10.00,0,5.50,2.00', model: '1h', total: '1h 30m 0s',
      types: 'PLA;PLA;PLA;PLA', colors: '#000000;#E5B03D;#FFFFFF;#4D3324', costs: '19.99;21.99;19.99;19.99',
    });
    const plate = parseGcodeText(multi, 'x.gcode').plates[0]!;
    expect(plate.grams).toBeCloseTo(17.5);
    expect(plate.filaments.map((f) => f.slot)).toEqual([1, 3, 4]); // slot 2 sem uso fica de fora
  });

  it('rejeita .gcode sem cabeçalho', async () => {
    const err = await parseError(Promise.resolve().then(() => parseGcodeText('G28\nG1 X10\n', 'x.gcode')));
    expect(err.code).toBe('invalid-file');
  });

  it('parseFile escolhe o leitor pela extensão', async () => {
    expect((await parseFile(new Blob([gcode]), 'a.gcode')).plates[0]!.grams).toBe(48.6);
    expect((await parseFile(new Blob([new Uint8Array(await fx.multiPlate())]), 'a.gcode.3mf')).plates).toHaveLength(2);
  });

  it('lê só o começo e o fim de um .gcode grande', async () => {
    const header = '; total filament weight [g] : 12.5\n; total estimated time: 1h 0m 0s\n';
    const filler = 'G1 X1 Y1 E0.1\n'.repeat(250_000); // ~3,5 MB de movimentos
    const config = '; filament_type = PETG\n; filament_colour = #FF0000\n';
    const text = await readGcodeText(new Blob([header, filler, config]));
    expect(text.length).toBeLessThan(2.1 * 1024 * 1024);
    const plate = parseGcodeText(text, 'grande.gcode').plates[0]!;
    expect(plate).toMatchObject({ grams: 12.5, seconds: 3600 });
    expect(plate.filaments[0]).toMatchObject({ type: 'PETG', color: '#FF0000' });
  });
});

describe('mainFilament', () => {
  it('escolhe o filamento com mais gramas', async () => {
    const project = await parseSlicedFile(await fx.multiPlate(), 'x.gcode.3mf');
    expect(mainFilament(project.plates[1]!)?.type).toBe('PLA');
    expect(mainFilament({ index: 1, grams: 1, seconds: null, filaments: [] })).toBeUndefined();
  });
});

describe('parseSliceInfo', () => {
  it('soma used_g quando falta o peso da placa', () => {
    const xml = fx.sliceInfoXml([
      { index: 1, prediction: '60', filaments: [{ id: 1, type: 'PLA', color: '#FFF', usedG: '1.5' }, { id: 2, type: 'PLA', color: '#000', usedG: '2.5' }] },
    ]);
    expect(parseSliceInfo(xml)![0]).toMatchObject({ grams: 4, seconds: 60 });
  });

  it('retorna null para XML inválido', () => {
    expect(parseSliceInfo('<config><plate>')).toBeNull();
  });
});

describe('parseGcodeHeader', () => {
  it('soma gramas listadas por filamento', () => {
    const info = parseGcodeHeader(fx.gcodeText({ weight: '15.00,7.10', model: '1h', total: '1h 5m 0s', types: 'PLA;PETG', colors: '#FFF;#000', costs: '120;80' }));
    expect(info.gramsList).toEqual([15, 7.1]);
    expect(info.grams).toBeCloseTo(22.1);
    expect(info.seconds).toBe(3900);
    expect(info.types).toEqual(['PLA', 'PETG']);
    expect(info.colors).toEqual(['#FFFFFF', '#000000']);
    expect(info.costs).toEqual([120, 80]);
  });

  it('entende o formato do Orca/Prusa', () => {
    const info = parseGcodeHeader('; filament used [g] = 10.5\n; estimated printing time (normal mode) = 1h 2m 3s\n');
    expect(info.grams).toBe(10.5);
    expect(info.seconds).toBe(3723);
  });

  it('retorna nulos quando não há cabeçalho', () => {
    const info = parseGcodeHeader('G28\nG1 X10\n');
    expect(info).toMatchObject({ grams: null, seconds: null, usedSlots: [], types: [], costs: [], profiles: [] });
  });

  it('usa "; filament:" para ligar cada peso ao slot, mesmo com slots sem uso', () => {
    const text = fx.gcodeText({
      weight: '10.00,5.00', model: '1h', total: '1h 0m 0s', slots: '1,3',
      types: 'PLA;PLA;PETG;PLA', colors: '#000000;#FFFFFF;#C12E1F;#1565C0', costs: '19.99;19.99;25;19.99',
      profiles: '"Bambu PLA Matte @BBL A1M";"Bambu PLA Basic @BBL A1M";"Bambu PETG HF @BBL A1M";"Bambu PLA Basic @BBL A1M"',
    });
    expect(parseGcodeText(text, 'x.gcode').plates[0]!.filaments).toEqual([
      { slot: 1, type: 'PLA', color: '#000000', grams: 10, profile: 'PLA Matte', pricePerKg: 19.99 },
      { slot: 3, type: 'PETG', color: '#C12E1F', grams: 5, profile: 'PETG HF', pricePerKg: 25 },
    ]);
  });
});

describe('G-code real do Bambu Studio 2.08 (A1 mini, 4 cores)', () => {
  // Trechos copiados de samples/coaster_PLA_55m33s.gcode (CRLF como no original).
  const real = [
    '; HEADER_BLOCK_START',
    '; BambuStudio 02.08.02.61',
    '; model printing time: 49m 25s; total estimated time: 55m 33s',
    '; total layer number: 12',
    '; total filament length [mm] : 4146.10,503.97,560.55,522.62',
    '; total filament volume [cm^3] : 9972.54,1212.19,1348.28,1257.04',
    '; total filament weight [g] : 13.16,1.53,1.78,1.58',
    '; filament_density: 1.32,1.26,1.32,1.26',
    '; filament_diameter: 1.75,1.75,1.75,1.75',
    '; max_z_height: 2.40',
    '; filament: 1,2,3,4',
    '; support_material_on_wipe_tower: 0',
    '; HEADER_BLOCK_END',
    '',
    '; CONFIG_BLOCK_START',
    '; filament_colour = #000000;#E5B03D;#FFFFFF;#4D3324',
    '; filament_cost = 19.99,19.99,19.99,19.99',
    '; filament_settings_id = "Bambu PLA Matte @BBL A1M";"Bambu PLA Basic @BBL A1M";"Bambu PLA Matte @BBL A1M";"Bambu PLA Basic @BBL A1M"',
    '; filament_type = PLA;PLA;PLA;PLA',
    '; CONFIG_BLOCK_END',
  ].join('\r\n');

  it('lê total sem ruído de ponto flutuante, tempo total e os 4 filamentos', () => {
    const { plates } = parseGcodeText(real, 'coaster_PLA_55m33s.gcode');
    expect(plates[0]).toMatchObject({ index: 1, grams: 18.05, seconds: 3333 });
    expect(plates[0]!.filaments).toEqual([
      { slot: 1, type: 'PLA', color: '#000000', grams: 13.16, profile: 'PLA Matte', pricePerKg: 19.99 },
      { slot: 2, type: 'PLA', color: '#E5B03D', grams: 1.53, profile: 'PLA Basic', pricePerKg: 19.99 },
      { slot: 3, type: 'PLA', color: '#FFFFFF', grams: 1.78, profile: 'PLA Matte', pricePerKg: 19.99 },
      { slot: 4, type: 'PLA', color: '#4D3324', grams: 1.58, profile: 'PLA Basic', pricePerKg: 19.99 },
    ]);
  });
});

describe('parseDuration', () => {
  it.each([
    ['2h 14m 0s', 8040],
    ['45m 3s', 2703],
    ['1d 2h 3m 4s', 93784],
    ['30s', 30],
    ['', null],
    ['sem tempo', null],
  ])('%s → %s', (text, expected) => {
    expect(parseDuration(text)).toBe(expected);
  });
});

describe('parseProjectSettings', () => {
  it('lê custos e perfis por slot (formato real: arrays de strings)', () => {
    const json = JSON.stringify({
      filament_cost: ['19.99', '21.99', '0'],
      filament_settings_id: ['Bambu PLA Matte @BBL A1M', 'Bambu PLA Silk @BBL A1M', 'Generic PLA'],
    });
    expect(parseProjectSettings(json)).toEqual({ costs: [19.99, 21.99, 0], profiles: ['PLA Matte', 'PLA Silk', 'Generic PLA'] });
  });
  it('tolera ausência e JSON inválido', () => {
    expect(parseProjectSettings('{}')).toEqual({ costs: [], profiles: [] });
    expect(parseProjectSettings('não é json')).toEqual({ costs: [], profiles: [] });
    expect(parseProjectSettings('{"filament_cost":"20;abc"}').costs).toEqual([20, 0]);
  });
});

describe('profileLabel', () => {
  it.each([
    ['Bambu PLA Matte @BBL A1M', 'PLA Matte'],
    ['"Bambu PLA Basic @BBL A1M"', 'PLA Basic'],
    ['Generic PETG @BBL X1C', 'Generic PETG'],
    ['Voolt PLA Silk', 'Voolt PLA Silk'],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(profileLabel(raw)).toBe(expected);
  });
});
