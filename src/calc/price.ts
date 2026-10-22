import { round2 } from './number';

export type Rounding = 'none' | '90' | '50';

export type EnergyInput = {
  watts: number;
  kwhPrice: number;
};

export type PriceInput = {
  plateGrams: number;
  /** Inteiro >= 1. */
  pieces: number;
  pricePerKg: number;
  bagPrice: number;
  /** Argola de chaveiro por peça; 0 ou ausente quando a peça não leva argola. */
  ringPrice?: number;
  /** R$ por hora de impressão da placa, dividido entre as peças. */
  hourPrice?: number;
  profitPct: number;
  rounding: Rounding;
  /** Segundos de impressão da placa; usado pelo preço da hora e pela energia. */
  plateSeconds?: number | null;
  energy?: EnergyInput | null;
};

export type PriceBreakdown = {
  gramsPerPiece: number;
  filament: number;
  bag: number;
  ring: number;
  time: number;
  energy: number;
  cost: number;
  profit: number;
  price: number;
};

/** Arredonda para centavos (meio para cima); ver round2. */
export function roundCents(value: number): number {
  return round2(value);
}

export function applyRounding(price: number, rounding: Rounding): number {
  const cents = Math.round(roundCents(price) * 100);
  if (cents <= 0) return 0;
  switch (rounding) {
    case 'none':
      return cents / 100;
    case '90': {
      // Menor valor terminado em ,90 que seja >= preço.
      let target = Math.floor(cents / 100) * 100 + 90;
      if (target < cents) target += 100;
      return target / 100;
    }
    case '50':
      return (Math.ceil(cents / 50) * 50) / 100;
  }
}

/**
 * Regras da seção 5 do plano. Valores intermediários ficam sem arredondar;
 * arredonde só para exibir (roundCents) e o preço final já sai arredondado.
 */
export function computePrice(input: PriceInput): PriceBreakdown {
  const pieces = Math.max(1, Math.floor(input.pieces));
  const gramsPerPiece = input.plateGrams / pieces;
  const filament = (gramsPerPiece / 1000) * input.pricePerKg;

  const hours = (input.plateSeconds ?? 0) / 3600;
  const time = ((input.hourPrice ?? 0) * hours) / pieces;
  const energy = input.energy ? (input.energy.watts * hours / 1000) * input.energy.kwhPrice / pieces : 0;
  const ring = input.ringPrice ?? 0;

  const cost = filament + input.bagPrice + ring + time + energy;
  const profit = (cost * input.profitPct) / 100;
  const price = applyRounding(cost + profit, input.rounding);

  return { gramsPerPiece, filament, bag: input.bagPrice, ring, time, energy, cost, profit, price };
}
