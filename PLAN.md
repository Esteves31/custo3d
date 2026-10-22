# Custo3D — Plano de execução

> Este arquivo é o briefing para o Claude Code. Trabalhe **uma fase por vez**, na ordem. Ao final de cada fase, rode os testes, mostre o resultado e espere aprovação antes de seguir.

## 1. Contexto

Uma pessoa vende peças impressas em 3D numa impressora Bambu Lab e fatia os projetos no **Bambu Studio**. Hoje ela copia as gramas do fatiador para um Excel e calcula o preço de venda à mão.

O Custo3D lê o arquivo fatiado (`.gcode.3mf`) e captura automaticamente as gramas e o tempo de cada placa. O usuário só informa:

- o preço do kg do filamento;
- o preço da sacolinha;
- o preço da hora de impressão;
- o preço da argola de chaveiro (só quando a peça leva argola);
- a % de lucro.

Com isso, o app mostra o preço de venda por peça.

**Quem vai usar:** um colega do autor, sem perfil técnico, no computador dele (assumir Windows + Chrome ou Edge).

## 2. Restrições (não negociáveis)

- **Um único arquivo HTML** como entrega final (`dist/custo3d.html`), com todo o JS e CSS embutidos. O colega recebe esse arquivo e dá dois cliques.
- **Zero backend, zero instalação, zero conta, zero nuvem.** Tudo roda no navegador e funciona offline.
- Nenhuma dependência carregada de CDN em tempo de execução. Tudo vai empacotado no build.
- Interface 100% em **português do Brasil**: moeda em R$, vírgula decimal, `toLocaleString('pt-BR')`.
- Poucas dependências. Prefira APIs nativas do navegador (`DOMParser`, File System Access API, `localStorage`, IndexedDB).

## 3. Stack

- **Vite + TypeScript, sem framework de UI.** As telas são poucas, então DOM simples com funções de render basta. Se o código de UI ficar confuso, pode usar Preact, que é leve.
- **`vite-plugin-singlefile`** para gerar o HTML único.
- **`jszip`** para abrir o `.3mf`, que é um ZIP.
- **`DOMParser`** nativo para ler o XML. Não use biblioteca de XML.
- **Vitest** para os testes do parser e do cálculo.
- **Fontes:** use a stack de sistema como padrão, para funcionar offline. Embutir as fontes do design (Space Grotesk, IBM Plex Sans, IBM Plex Mono) como woff2 é opcional, só se o tamanho final continuar abaixo de ~1,5 MB.

Estrutura sugerida:

```
src/
  parser/   leitura do .3mf → dados das placas
  calc/     funções puras de cálculo e formatação
  store/    configurações e histórico (localStorage) + handle da pasta (IndexedDB)
  watch/    monitoramento da pasta
  ui/       telas e componentes
samples/    arquivos .gcode.3mf reais para testes
design/     telas de referência (ver seção 7)
```

## 4. Dados de entrada: o arquivo fatiado

O `.gcode.3mf` exportado pelo Bambu Studio ("Exportar arquivo fatiado da placa" ou "Exportar todas as placas fatiadas") é um ZIP.

**Fonte principal: `Metadata/slice_info.config` (XML).** Tem um bloco por placa fatiada, em formato parecido com este:

```xml
<config>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="prediction" value="8040"/>   <!-- tempo estimado, provavelmente em segundos -->
    <metadata key="weight" value="48.60"/>      <!-- gramas totais da placa -->
    <filament id="1" type="PLA" color="#000000" used_m="16.1" used_g="48.60"/>
  </plate>
</config>
```

**Fonte de reserva: o cabeçalho do G-code** em `Metadata/plate_N.gcode`. Ele traz comentários com o peso total do filamento e o tempo estimado. Use essa fonte só se o `slice_info.config` não tiver os dados.

**Preço do filamento (bônus):** `Metadata/project_settings.config` é um JSON com as configurações do projeto. Ele pode ter o preço por kg do perfil de filamento (provavelmente na chave `filament_cost`, um array por slot). Se existir e for maior que 0, ofereça esse valor.

> ⚠️ **Antes de escrever o parser, inspecione os arquivos reais em `samples/`.** Os nomes de chaves e unidades acima vêm de pesquisa e precisam ser confirmados. Se `samples/` estiver vazio, pare e peça um arquivo de exemplo.
>
> Um `.3mf` de projeto **não fatiado** não tem consumo de filamento. Nesse caso, mostre uma mensagem clara: "Este arquivo ainda não foi fatiado. No Bambu Studio, fatie e use *Exportar arquivo fatiado da placa*."

Modelo interno:

```ts
type Plate = {
  index: number;
  grams: number;
  seconds: number | null;
  filaments: { type: string; color: string; grams: number }[];
};

type SlicedProject = {
  fileName: string;
  plates: Plate[];
  filamentPricePerKg?: number;
};
```

## 5. Regras de cálculo

Todas as funções de cálculo são puras, ficam em `src/calc/` e têm testes.

```
gramasPorPeca = gramasDaPlaca / pecasNaPlaca          (pecasNaPlaca >= 1, inteiro)
filamento     = gramasPorPeca / 1000 * precoKg
tempo         = precoHora * horasDaPlaca / pecasNaPlaca                   (sem tempo no arquivo: 0)
argola        = precoArgola                                           (só com "Leva argola" marcado; senão 0)
energia       = (watts * horasDaPlaca / 1000 * tarifaKwh) / pecasNaPlaca   (só se ativado; senão 0)
custo         = filamento + sacolinha + argola + tempo + energia
lucro         = custo * lucroPct / 100                 (markup sobre o custo)
preco         = arredondar(custo + lucro)
```

**Arredondamento** (configurável):

| Opção | Regra |
|---|---|
| Não arredondar | 2 casas decimais |
| ",90" | o menor valor terminado em ,90 que seja maior ou igual ao preço |
| "R$ 0,50" | `Math.ceil(preco * 2) / 2` |

**Precisão:** arredonde para centavos com `Math.round((x + Number.EPSILON) * 100) / 100` só no final. O primeiro caso de teste abaixo (15,455 → 15,46) existe justamente para pegar erro de ponto flutuante.

**Entrada de números:** aceitar `120,00`, `120.5`, `1.234,56` e `0,35`. Entrada inválida mostra o erro no campo e não quebra o cálculo.

**Casos de teste obrigatórios:**

| gramas | peças | R$/kg | sacolinha | lucro | arredond. | custo esperado | preço esperado |
|---|---|---|---|---|---|---|---|
| 48,6 | 1 | 120,00 | 0,35 | 150% | nenhum | 6,18 | 15,46 |
| 48,6 | 1 | 120,00 | 0,35 | 150% | ,90 | 6,18 | 15,90 |
| 48,6 | 1 | 120,00 | 0,35 | 150% | 0,50 | 6,18 | 15,50 |
| 48,6 | 4 | 120,00 | 0,35 | 100% | nenhum | 1,81 | 3,62 |
| 22,1 | 1 | 0 | 0 | 0% | nenhum | 0,00 | 0,00 |

## 6. Funcionalidades por fase

### Fase 0 — Base do projeto
- Vite + TS + `vite-plugin-singlefile` + Vitest configurados.
- `npm run build` gera `dist/custo3d.html`, e esse arquivo abre por duplo clique (`file://`) no Chrome e no Edge.
- **Teste de viabilidade:** confirmar que `window.showDirectoryPicker` funciona a partir de `file://`. O resultado decide a Fase 3.
- Pronto quando: build gera um HTML único que abre offline e mostra "Olá, Custo3D".

### Fase 1 — Parser + cálculo (núcleo)
- Inspecionar `samples/`, implementar o parser com fallback para o G-code e escrever testes com os arquivos reais.
- Implementar `calc/` com todos os casos da seção 5.
- Pronto quando: `npm test` passa e os testes cobrem um arquivo com várias placas e um arquivo não fatiado.

### Fase 2 — Calculadora com arrastar e soltar (MVP utilizável)
- Tela principal conforme `design/Main.dc.html`.
- Área para arrastar o `.gcode.3mf`, além de um botão "Abrir arquivo".
- Seletor de placa, cards de gramas, tempo, material e cor, e campos de preço, sacolinha, lucro e peças.
- Resultado com o detalhamento e o preço de venda em destaque.
- Botão "Copiar preço" copia o valor formatado (`R$ 15,46`).
- O último preço/kg, a sacolinha e o lucro ficam salvos (`localStorage`) e já vêm preenchidos.
- Pronto quando: o colega consegue usar só com esta fase. **Fazer uma entrega intermediária aqui.**

### Fase 3 — Pasta monitorada (captura automática)
- Em Configurações: botão "Escolher pasta" (`showDirectoryPicker`). Guardar o handle no IndexedDB.
- Ao abrir o app, se a permissão precisar ser renovada, mostrar o botão "Reconectar pasta". O navegador exige um clique para isso.
- Verificar a pasta a cada ~2 s, procurando `.gcode.3mf` novo ou modificado (comparar `lastModified`). Ao detectar, carregar o arquivo automaticamente e mostrar o indicador "Monitorando" com o horário da última captura.
- Se a API não funcionar em `file://` (ver Fase 0): parar e apresentar alternativas (servidor local mínimo via `.bat` ou empacotar com Tauri). Não decidir sozinho.

### Fase 4 — Configurações
- Tela conforme `design/Configuracoes.dc.html`:
  - **Filamentos:** cadastro de material, marca e R$/kg, com um padrão. O app escolhe o preço pelo `type` do filamento lido no arquivo.
  - **Embalagens:** cadastro de nome e preço; a calculadora vira um select.
  - **Padrões:** lucro padrão e arredondamento.
  - **Energia:** toggle, watts e tarifa.
  - Opção "usar preço do perfil do Bambu Studio quando houver".
- Exportar e importar as configurações como `.json`, para o autor mandar um arquivo já configurado para o colega.

### Fase 5 — Histórico
> Feito: aba "Histórico" (`#historico`), últimas 500 cotações no `localStorage`.

- "Salvar no histórico" guarda data, arquivo, placa, peças, gramas, custo, lucro% e preço.
- Lista com busca simples e botão de excluir.
- Botão "Exportar CSV" com `;` como separador e vírgula decimal, para abrir direto no Excel em pt-BR.

**Itens vendidos** (feito): aba `#vendidos`, chave `custo3d:vendas:v1`, sem limite.
- Botão "Vendido" em cada linha do Histórico copia a cotação para a lista de vendas (uma venda por cotação). Excluir a cotação não apaga a venda.
- Caixa "Pago" por venda, filtro por data da venda (de/até), filtro de pagamento (todos / a receber / pagos), busca pelo nome, totais (vendido, recebido, a receber) e "Exportar CSV".

**Resumo** (feito): aba `#resumo`, agora a tela inicial (hash vazio abre nela; a calculadora fica em `#calculadora`).
- Tiles: vendido e lucro no mês atual (com o mês passado), a receber (botão "Ver quais" abre Itens vendidos filtrado) e total vendido.
- Gráfico de colunas Vendido × Lucro dos últimos 6 meses, feito em HTML/CSS sem biblioteca, com tooltip e "Ver em tabela".
- Lucro da venda = preço − custo (continua certo com o preço arredondado). Mês = mês de `soldAt` no fuso do computador.
- Últimas 5 vendas com selo Pago / A receber.

### Fase 6 (opcional) — Mini janela flutuante
- Conforme `design/Widget.dc.html`, usando a **Document Picture-in-Picture API** (Chrome/Edge), que abre uma janela pequena sempre por cima.
- Botão "Mini janela" na tela principal. A mini janela mostra o projeto atual, os três campos e o preço, sincronizados com a janela principal.
- Se a API não existir no navegador, esconder o botão.

## 7. Design de referência

A pasta `design/` tem as telas aprovadas: `Main.dc.html`, `Configuracoes.dc.html` e `Widget.dc.html`.

Elas foram feitas num editor de design e usam um runtime próprio (`support.js`, sintaxe `{{...}}`, `<sc-for>`). **Não tente rodá-las.** Use-as como referência visual: layout, textos, espaçamentos e as cores e tamanhos nos `style` inline. A lógica de cálculo dentro delas é só demonstrativa; a regra oficial é a seção 5.

Tokens principais:

| Uso | Valor |
|---|---|
| Fundo | `#EEF1F4` |
| Cartões | `#FFFFFF`, borda `#D5DAE0`, raio 14px |
| Texto | `#15191E` |
| Texto secundário | `#4B5563` |
| Cabeçalho e cartão de resultado | `#15191E` |
| Ação principal | `#C2410C` (texto branco) |
| Destaque no escuro | `#FDBA74` |
| Sucesso | `#14532D` sobre `#DCFCE7` |
| Números | fonte monoespaçada |

Requisitos de acessibilidade:
- Alvos de clique com no mínimo 44px.
- `<label>` em todos os campos.
- Contraste mínimo de 4.5:1.
- Layout responsivo: as colunas empilham em telas estreitas.

## 8. Entrega para o colega

- `dist/custo3d.html` e um `LEIA-ME.txt` curto, em português, com:
  1. Abrir no Chrome ou Edge.
  2. Em Configurações, escolher a pasta onde salva os arquivos fatiados e cadastrar os preços.
  3. No Bambu Studio, depois de fatiar, usar "Exportar arquivo fatiado da placa" nessa pasta.
- Opcional: um `config.json` pré-preenchido, para importar na Fase 4.

## 9. Fora do escopo

Login, nuvem, sincronização entre computadores, integração com a impressora (MQTT/LAN), APIs não oficiais da Bambu e instalador.
