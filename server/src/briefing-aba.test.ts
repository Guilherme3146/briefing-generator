import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { acrescentarAlteracoes, gerarPlanilha, textoDaCelula, ABA_ALTERACAO } from "./xlsx.js";
import { ABA_BRIEFING, separarMarcadores } from "./resumo.js";
import { extensaoDaImagem, tamanhoDaImagem, caber } from "./imagem.js";
import { BriefingSchema } from "./schema.js";

/**
 * A aba "Briefing": a versão para ler e acompanhar. Layout (1-based):
 *   linhas 1-3 faixa (título, rodada, andamento ao vivo) · 4 guia de uso · 5 cabeçalho · 6+ alterações
 *   colunas: 1 # · 2 Andamento · 3 O que fazer · 4 Onde · 5 Prints · 6 Links e observações
 */

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
    { ordem: 2, grupo: "mudanças na página de produtos", solicitacao: "substituir as imagens da categoria acrílico", url_pagina: "https://exemplo.com.br/produtos", secao: "produtos > acrílico" },
    { ordem: 3, grupo: "mudanças na página de produtos", solicitacao: "adicionar a categoria Luminosos", url_pagina: "https://exemplo.com.br/produtos", secao: "produtos" },
  ],
});

const PNG_REAL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function abrirBuffer(b: Buffer | ExcelJS.Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(b as any);
  return wb;
}
async function gerar(extra: Parameters<typeof gerarPlanilha>[0]["prints"] = []) {
  return abrirBuffer(await gerarPlanilha({ templatePath: TEMPLATE, briefing, prints: extra }));
}
const txt = (ws: ExcelJS.Worksheet, l: number, c: number) => textoDaCelula(ws.getCell(l, c).value);
const formula = (ws: ExcelJS.Worksheet, l: number, c: number): string => (ws.getCell(l, c).value as any)?.formula ?? "";

function png(l: number, a: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(l, 16);
  b.writeUInt32BE(a, 20);
  return b;
}

test("aba Briefing: título, guia de uso, cabeçalho e as 3 alterações, com o grupo como faixa e sem os marcadores", async () => {
  const ws = (await gerar()).getWorksheet(ABA_BRIEFING)!;
  assert.equal(txt(ws, 1, 1), "Cliente Exemplo");
  assert.match(txt(ws, 2, 1), /Rodada 1/);
  assert.match(txt(ws, 4, 1), /Esta aba é para ler/);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((c) => txt(ws, 5, c)), ["#", "Andamento", "O que fazer", "Onde", "Prints", "Links e observações"]);
  assert.match(txt(ws, 6, 3), /trocar o banner da home/);
  assert.match(txt(ws, 6, 4), /PÁGINA\nhttps:\/\/exemplo.com.br\/\nSEÇÃO\nhome › banner/);
  assert.match(txt(ws, 6, 6), /LINKS\nhttps:\/\/exemplo.com\/pasta\nhttps:\/\/exemplo.com\/pasta2/);
  assert.equal(txt(ws, 7, 1), "MUDANÇAS NA PÁGINA DE PRODUTOS", "o grupo vira uma faixa");
  assert.equal(txt(ws, 8, 3), "substituir as imagens da categoria acrílico");
  assert.equal(txt(ws, 9, 3), "adicionar a categoria Luminosos");
  for (const l of [6, 8, 9]) assert.doesNotMatch(txt(ws, l, 3), /\*{3}|^início de|^fim de/m);
});

test("aba Briefing: o status é AO VIVO, por fórmula sobre G/H/I da aba Alteração", async () => {
  const ws = (await gerar()).getWorksheet(ABA_BRIEFING)!;
  const f = formula(ws, 6, 2);
  assert.match(f, /'Alteração'!G3/);
  assert.match(f, /'Alteração'!H3/);
  assert.match(f, /'Alteração'!I3/);
  assert.match(formula(ws, 8, 2), /'Alteração'!G4/);
  assert.equal(txt(ws, 6, 2), "Aguardando\nImplem. —  ·  Design —", "valor guardado para quem abre sem recalcular");
  assert.match(formula(ws, 3, 1), /Andamento: .*COUNTA\('Alteração'!\$A\$3:\$A\$98\)/);
  assert.match(txt(ws, 3, 1), /Andamento: 0 de 3 finalizadas \(0%\)/);
});

test("aba Briefing: cores dos status (amarelo/verde/cinza) valem para o que a produção marcar depois", async () => {
  const ws = (await gerar()).getWorksheet(ABA_BRIEFING)!;
  const regras = ws.conditionalFormattings.flatMap((c: any) => c.rules.map((r: any) => ({ ref: c.ref, texto: r.formulae?.[0] ?? "", fundo: r.style?.fill?.bgColor?.argb })));
  const por = (t: string) => regras.find((r: any) => r.texto.includes(`"${t}"`));
  assert.equal(por("Finalizado")?.fundo, "FFD9F2E6", "Finalizado = verde");
  assert.equal(por("Pendente")?.fundo, "FFFFF1C9", "Pendente = amarelo");
  assert.ok(por("Aguardando"), "Aguardando = cinza");
  assert.match(por("Finalizado")!.ref, /^B6:B9$/);
});

test("aba Briefing: o andamento já marcado na aba Alteração aparece ao acrescentar (nada volta para Aguardando)", async () => {
  const wb0 = await gerar();
  const alt = wb0.getWorksheet(ABA_ALTERACAO)!;
  alt.getCell("G3").value = "Finalizado";
  alt.getCell("H3").value = true;
  alt.getCell("G4").value = "Pendente";
  const emExecucao = Buffer.from(await wb0.xlsx.writeBuffer());
  const extra = BriefingSchema.parse({ cliente: "X", alteracoes: [{ ordem: 1, solicitacao: "nova", url_pagina: "https://a.com/", secao: "home" }] });
  const r = await acrescentarAlteracoes({ arquivo: emExecucao, briefing: extra });
  const ws = (await abrirBuffer(r.arquivo)).getWorksheet(ABA_BRIEFING)!;
  assert.equal(txt(ws, 6, 2), "Finalizado\nImplem. ✓  ·  Design —");
  assert.match(txt(ws, 8, 2), /^Pendente\n/);
  assert.match(txt(ws, 3, 1), /Andamento: 1 de 4 finalizadas \(25%\)/);
  // a aba de trabalho não foi tocada
  assert.equal(r.arquivo.length > 0 && (await abrirBuffer(r.arquivo)).getWorksheet(ABA_ALTERACAO)!.getCell("G3").value, "Finalizado");
});

test("aba Briefing: legenda dos status para todos entenderem", async () => {
  const ws = (await gerar()).getWorksheet(ABA_BRIEFING)!;
  const linhas: string[] = [];
  ws.eachRow((row) => linhas.push(textoDaCelula(row.getCell(2).value) + "|" + textoDaCelula(row.getCell(3).value)));
  assert.ok(linhas.some((l) => l.startsWith("Aguardando|Ainda não")));
  assert.ok(linhas.some((l) => l.startsWith("Pendente|Depende")));
  assert.ok(linhas.some((l) => l.startsWith("Finalizado|Pronta")));
});

test("aba Briefing: número é link para a linha da aba Alteração, é protegida, é a aba ativa e recalcula ao abrir", async () => {
  const buffer = await gerarPlanilha({ templatePath: TEMPLATE, briefing });
  const wb = await abrirBuffer(buffer);
  const ws = wb.getWorksheet(ABA_BRIEFING)!;
  assert.equal((ws.getCell(6, 1).value as any).hyperlink, "#'Alteração'!A3");
  assert.ok((ws as any).sheetProtection?.sheet, "protegida contra edição");
  assert.equal(wb.views[0].activeTab, wb.worksheets.findIndex((w) => w.name === ABA_BRIEFING));
  const xml = await (await JSZip.loadAsync(buffer)).file("xl/workbook.xml")!.async("string");
  assert.match(xml, /<calcPr[^>]*fullCalcOnLoad="1"/, "o Excel recalcula as fórmulas de andamento ao abrir");
});

test("aba Briefing: a aba Alteração segue exatamente como antes (colunas A-F, G/H/I intocadas)", async () => {
  const ws = (await gerar()).getWorksheet(ABA_ALTERACAO)!;
  assert.match(String(ws.getCell("A3").value), /trocar o banner/);
  assert.equal(ws.getCell("G3").value, "Aguardando");
  assert.equal(ws.getCell("H3").value, false);
});

test("aba Briefing: acrescentar mostra o conjunto TODO e registra a rodada 2 no histórico", async () => {
  const primeira = await gerarPlanilha({ templatePath: TEMPLATE, briefing });
  const extra = BriefingSchema.parse({ cliente: "Cliente Exemplo", url_base: "https://exemplo.com.br/", alteracoes: [{ ordem: 1, solicitacao: "remover o vídeo da home", url_pagina: "https://exemplo.com.br/", secao: "home" }] });
  const r = await acrescentarAlteracoes({ arquivo: primeira, briefing: extra });
  const wb = await abrirBuffer(r.arquivo);
  assert.equal(wb.worksheets.filter((w) => w.name === ABA_BRIEFING).length, 1, "a aba é refeita, não duplicada");
  const ws = wb.getWorksheet(ABA_BRIEFING)!;
  assert.match(txt(ws, 2, 1), /Rodada 2/);
  assert.match(txt(ws, 3, 1), /de 4 finalizadas/);

  const rodadas: string[][] = [];
  ws.eachRow((row) => {
    if (/^Rodada [0-9]+$/.test(txt(ws, row.number, 1))) rodadas.push([1, 3, 4].map((c) => txt(ws, row.number, c)));
  });
  assert.deepEqual(rodadas, [["Rodada 1", "3", "3"], ["Rodada 2", "1", "4"]]);
});

test("aba Briefing: planilha antiga sem a aba vira rodada 1 (já existiam) + rodada 2", async () => {
  const wb0 = await gerar();
  wb0.removeWorksheet(wb0.getWorksheet(ABA_BRIEFING)!.id);
  const antiga = Buffer.from(await wb0.xlsx.writeBuffer());
  const extra = BriefingSchema.parse({ cliente: "X", alteracoes: [{ ordem: 1, solicitacao: "nova", url_pagina: "https://a.com/", secao: "home" }] });
  const r = await acrescentarAlteracoes({ arquivo: antiga, briefing: extra });
  const ws = (await abrirBuffer(r.arquivo)).getWorksheet(ABA_BRIEFING)!;
  assert.match(txt(ws, 2, 1), /Rodada 2/);
  assert.match(txt(ws, 3, 1), /de 4 finalizadas/);
});

test("separarMarcadores: início e fim de grupo na mesma célula do primeiro e do último item", () => {
  assert.deepEqual(separarMarcadores("****\ninício de X\n\ntexto 1", ""), { grupo: "X", grupoDepois: "X", texto: "texto 1" });
  assert.deepEqual(separarMarcadores("texto 2\n\nfim de X\n***", "X"), { grupo: "X", grupoDepois: "", texto: "texto 2" });
  assert.deepEqual(separarMarcadores("avulso", ""), { grupo: "", grupoDepois: "", texto: "avulso" });
});

// ------------------------------------------------------------------ prints

test("imagem: formato pelo conteúdo, tamanho pelo cabeçalho, e cabe na caixa sem esticar", () => {
  assert.equal(extensaoDaImagem(png(10, 10)), "png");
  assert.equal(extensaoDaImagem(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "jpeg");
  assert.equal(extensaoDaImagem(Buffer.from("GIF89a....")), "gif");
  assert.equal(extensaoDaImagem(Buffer.from("RIFF....WEBP")), null, "webp não é aceito");
  assert.deepEqual(tamanhoDaImagem(png(1920, 1080)), { largura: 1920, altura: 1080 });
  assert.deepEqual(caber({ largura: 1920, altura: 1080 }, 300, 190), { width: 300, height: 169 });
  assert.deepEqual(caber({ largura: 1000, altura: 3000 }, 300, 190), { width: 63, height: 190 }, "print alto cabe pela altura");
  assert.deepEqual(caber({ largura: 100, altura: 50 }, 300, 190), { width: 100, height: 50 }, "nunca aumenta");
});

test("aba Briefing: os prints aparecem ao lado da alteração, na proporção, e a linha cresce para caber", async () => {
  const wb = await gerar([
    { ordem: 1, buffer: PNG_REAL, extensao: "png" },
    { ordem: 1, buffer: PNG_REAL, extensao: "png" },
    { ordem: 3, buffer: PNG_REAL, extensao: "png" },
  ]);
  const ws = wb.getWorksheet(ABA_BRIEFING)!;
  const imgs = ws.getImages();
  assert.equal(imgs.length, 3);
  const porLinha = (l: number) => imgs.filter((i) => i.range.tl.nativeRow === l - 1);
  assert.equal(porLinha(6).length, 2, "dois prints na alteração 1 (linha 6), empilhados");
  assert.ok(imgs.every((i) => i.range.tl.nativeCol === 4), "todos na coluna Prints");
  assert.equal(new Set(porLinha(6).map((i) => i.range.tl.nativeRowOff)).size, 2, "um não cobre o outro");
  assert.ok((ws.getRow(6).height ?? 0) >= 30);
  assert.equal(porLinha(9).length, 1, "a alteração 3 fica na linha 9 (depois da faixa do grupo)");
  for (const l of [6, 8, 9]) assert.doesNotMatch(txt(ws, l, 6), /📎/);
});

test("aba Briefing: ao acrescentar, os prints das rodadas anteriores continuam aparecendo", async () => {
  const primeira = await gerarPlanilha({ templatePath: TEMPLATE, briefing, prints: [{ ordem: 2, buffer: PNG_REAL, extensao: "png" }] });
  const extra = BriefingSchema.parse({ cliente: "Cliente Exemplo", alteracoes: [{ ordem: 1, solicitacao: "nova", url_pagina: "https://a.com/", secao: "home" }] });
  const r = await acrescentarAlteracoes({ arquivo: primeira, briefing: extra, prints: [{ ordem: 1, buffer: PNG_REAL, extensao: "png" }] });
  assert.equal((await abrirBuffer(r.arquivo)).getWorksheet(ABA_BRIEFING)!.getImages().length, 2);
});

test("print colado à mão pela produção na aba Prints não vira print de nenhuma alteração", async () => {
  const wb0 = await gerar();
  const wsP = wb0.getWorksheet("Prints")!;
  wsP.getCell(95, 1).value = "Linha 3 — texto qualquer";
  const id = wb0.addImage({ buffer: PNG_REAL as any, extension: "png" });
  wsP.addImage(id, { tl: { col: 0, row: 100 } as any, ext: { width: 50, height: 50 } }); // fora do passo de 13 linhas
  const reaberto = Buffer.from(await wb0.xlsx.writeBuffer());
  const extra = BriefingSchema.parse({ cliente: "X", alteracoes: [{ ordem: 1, solicitacao: "nova", url_pagina: "https://a.com/", secao: "home" }] });
  const r = await acrescentarAlteracoes({ arquivo: reaberto, briefing: extra });
  assert.equal((await abrirBuffer(r.arquivo)).getWorksheet(ABA_BRIEFING)!.getImages().length, 0);
});
