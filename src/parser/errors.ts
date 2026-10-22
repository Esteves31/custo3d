export type ParseErrorCode = 'not-sliced' | 'invalid-file';

export class ParseError extends Error {
  readonly code: ParseErrorCode;

  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
  }
}

// O .3mf de projeto não guarda peso nem tempo mesmo depois de fatiar (confirmado com arquivo real),
// então a mensagem explica a diferença em vez de dizer só "não foi fatiado".
export const NOT_SLICED_MESSAGE =
  'Este é o arquivo de projeto do Bambu Studio. Ele não guarda o peso nem o tempo de impressão, mesmo depois de fatiar. ' +
  'No Bambu Studio, fatie e use Exportar arquivo fatiado da placa: isso gera um arquivo .gcode.3mf ' +
  '(o Windows pode mostrar só .gcode), que é o que a calculadora lê.';

export const INVALID_FILE_MESSAGE =
  'Não consegui ler este arquivo. Use o arquivo .gcode.3mf ou .gcode exportado pelo Bambu Studio.';

export const notSliced = () => new ParseError('not-sliced', NOT_SLICED_MESSAGE);
export const invalidFile = () => new ParseError('invalid-file', INVALID_FILE_MESSAGE);
