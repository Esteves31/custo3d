export type Filament = {
  /** Slot do filamento no projeto (1, 2, ...). */
  slot: number;
  type: string;
  /** Cor em #RRGGBB, ou string vazia se o arquivo não informar. */
  color: string;
  grams: number;
  /** Nome curto do perfil de filamento, ex.: "PLA Matte" (de "Bambu PLA Matte @BBL A1M"). */
  profile?: string;
  /** R$/kg do perfil de filamento do Bambu Studio, se existir e for > 0. */
  pricePerKg?: number;
};

export type Plate = {
  index: number;
  grams: number;
  seconds: number | null;
  filaments: Filament[];
};

export type SlicedProject = {
  fileName: string;
  plates: Plate[];
  /** Preço do perfil do filamento principal da primeira placa, se houver. */
  filamentPricePerKg?: number;
};
