import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { gerarPlanilha, nomeDoArquivo, textoDaCelula, ABA_ALTERACAO } from "./xlsx.js";
import { BriefingSchema } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "..", "..", "templates", "briefing-modelo.xlsx");

const briefing = BriefingSchema.parse({
  cliente: "Cliente Exemplo",
  url_base: "https://exemplo.com.br/",
  alteracoes: [
    {
      ordem: 1,
      solicitacao: "trocar o banner da home pela imagem em link conteúdo",
      url_pagina: "https://exemplo.com.br/",
      secao: "home\nbanner",
      link_conteudo: ["https://exemplo.com/pasta", "https://exemplo.com/pasta2"],
    },
    {
      ordem: 2,
      grupo: "mudanças na página de produtos",
      solicitacao: "substituir as imagens da categoria acrílico",
      url_pagina: "https://exemplo.com.br/produtos",
      secao: "produtos > acrílico",
    },
    {
      ordem: 3,
      grupo: "mudanças na página de produtos",
      solicitacao: "adicionar a categoria Luminosos",
      url_pagina: "https://exemplo.com.br/produtos",
      secao: "produtos",
    },
  ],
});

async function gerarEAbrir() {
  const buffer = await gerarPlanilha({ templatePath: TEMPLATE, briefing });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return wb;
}

test("preserva as 5 abas do template", async () => {
  const wb = await gerarEAbrir();
  assert.deepEqual(wb.worksheets.map((w) => w.name), [
    "Site",
    "Alteração",
    "Complemento de Mockup",
    "Prints",
    "FAQ",
  ]);
});

test("preserva a formula de matriz do progresso em A1", async () => {
  const wb = await gerarEAbrir();
  const a1: any = wb.getWorksheet(ABA_ALTERACAO)!.getCell("A1").value;
  assert.ok(a1?.formula, "A1 deveria continuar sendo formula");
  assert.match(a1.formula, /Progresso/);
});

test("preserva os prints fixos da aba Prints e o FAQ", async () => {
  const wb = await gerarEAbrir();
  assert.equal(wb.getWorksheet("Prints")!.getImages().length, 3);
  assert.equal(wb.getWorksheet("FAQ")!.rowCount, 52);
});

test("prints vão pra aba Prints, não ficam mais embutidos e sobrepostos na célula", async () => {
  const PNG_1PX =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const buffer = await gerarPlanilha({
    templatePath: TEMPLATE,
    briefing,
    prints: [
      { ordem: 1, buffer: Buffer.from(PNG_1PX, "base64"), extensao: "png" },
      { ordem: 1, buffer: Buffer.from(PNG_1PX, "base64"), extensao: "png" },
    ],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const wsAlt = wb.getWorksheet(ABA_ALTERACAO)!;
  assert.equal(wsAlt.getImages().length, 0, "nenhum print fica embutido na aba Alteração");
  assert.match(
    textoDaCelula(wsAlt.getCell("E3").value),
    /aba "Prints", linha \d+/,
    "a célula de Obs. Implementação aponta pra aba Prints",
  );

  const wsPrints = wb.getWorksheet("Prints")!;
  // 3 prints fixos de instrução do template + os 2 novos desta alteração
  assert.equal(wsPrints.getImages().length, 5);
  const linhas = wsPrints.getImages().map((i) => i.range.tl.nativeRow);
  assert.equal(new Set(linhas).size, linhas.length, "os dois prints da mesma alteração não se sobrepõem");
});

test("escreve as colunas A-F a partir da linha 3", async () => {
  const ws = (await gerarEAbrir()).getWorksheet(ABA_ALTERACAO)!;
  assert.match(String(ws.getCell("A3").value), /trocar o banner/);
  assert.equal(ws.getCell("B3").value, "https://exemplo.com.br/");
  assert.equal(ws.getCell("C3").value, "home\nbanner");
  assert.equal(ws.getCell("D3").value, "https://exemplo.com/pasta\nhttps://exemplo.com/pasta2");
});

test("nao toca nas colunas G, H e I", async () => {
  const ws = (await gerarEAbrir()).getWorksheet(ABA_ALTERACAO)!;
  assert.equal(ws.getCell("G3").value, "Aguardando");
  assert.equal(ws.getCell("H3").value, false);
  assert.equal(ws.getCell("I3").value, false);
});

test("marca inicio e fim do grupo no texto da coluna A", async () => {
  const ws = (await gerarEAbrir()).getWorksheet(ABA_ALTERACAO)!;
  const l4 = String(ws.getCell("A4").value);
  const l5 = String(ws.getCell("A5").value);
  assert.match(l4, /^\*\*\*\*\ninício de mudanças na página de produtos/);
  assert.ok(!/fim de/.test(l4), "a linha do meio nao fecha o grupo");
  assert.match(l5, /fim de mudanças na página de produtos\n\*\*\*$/);
});

test("recusa briefing vazio", async () => {
  await assert.rejects(
    () => gerarPlanilha({ templatePath: TEMPLATE, briefing: { cliente: "", url_base: "", alteracoes: [] } }),
    /Nenhuma alteração/,
  );
});

test("nome do arquivo sai sem acento e com a data", () => {
  const nome = nomeDoArquivo("Amorim Letreiros & Cia", new Date("2026-10-02T12:00:00Z"));
  assert.equal(nome, "amorim-letreiros-cia-alteracao-2026-10-02.xlsx");
});
