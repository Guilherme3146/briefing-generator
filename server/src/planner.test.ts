import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { acrescentarAlteracoes, gerarPlanilha, textoDaCelula } from "./xlsx.js";
import { ABA_PLANNER, ST_ENVIADA, ST_EXISTIA, ST_PENDENTE, TABELA_PLANNER, descricaoDaTarefa, tituloDaTarefa } from "./planner.js";
import { BriefingSchema } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "..", "..", "templates", "briefing-modelo.xlsx");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const briefing = BriefingSchema.parse({
  cliente: "Vert Portas",
  url_base: "https://vert.com.br/",
  alteracoes: [
    { ordem: 1, grupo: "Ficha técnica", solicitacao: "Atualizar a altura para 2,10 m", url_pagina: "https://vert.com.br/correr", secao: "ficha técnica" },
    {
      ordem: 2,
      grupo: "Ficha técnica",
      solicitacao: "Adicionar os tipos de núcleo",
      url_pagina: "https://vert.com.br/correr",
      secao: "ficha técnica",
      link_conteudo: ["https://drive.com/catalogo"],
      obs_implementacao: "Slide 2 do catálogo.",
    },
    { ordem: 3, solicitacao: "Trocar o telefone do rodapé", url_pagina: "https://vert.com.br/", secao: "rodapé" },
  ],
});

const abrir = async (b: Buffer | ExcelJS.Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(b as any);
  return wb;
};
const txt = (ws: ExcelJS.Worksheet, l: number, c: number) => textoDaCelula(ws.getCell(l, c).value);
/** linhas de dados da tabela: o cabeçalho fica na linha 4, os dados a partir da 5 */
const linhaPlanner = (ws: ExcelJS.Worksheet, n: number) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => txt(ws, 4 + n, c));

test("aba Planner: tabela 'Tarefas' com os cabeçalhos que o fluxo espera e uma linha por alteração", async () => {
  const buffer = await gerarPlanilha({ templatePath: TEMPLATE, briefing });
  const wb = await abrir(buffer);
  const ws = wb.getWorksheet(ABA_PLANNER)!;
  assert.ok(ws, "a aba existe");
  assert.deepEqual(linhaPlanner(ws, 0), ["Chave", "Status do envio", "Título", "Descrição", "Balde", "Etiqueta", "Checklist", "Prints (link da pasta)", "Link da tarefa"]);

  // o conector do Excel só lê TABELAS: confere no XML do arquivo, não só nas células
  const zip = await JSZip.loadAsync(buffer);
  const tabelas = await Promise.all(Object.keys(zip.files).filter((n) => /xl\/tables\/table\d+\.xml$/.test(n)).map((n) => zip.file(n)!.async("string")));
  assert.ok(tabelas.some((x) => x.includes(`displayName="${TABELA_PLANNER}"`)), "tabela Tarefas definida no arquivo");

  const l1 = linhaPlanner(ws, 1);
  assert.equal(l1[0], "Linha 3", "a chave é a linha da aba Alteração");
  assert.equal(l1[1], ST_PENDENTE);
  assert.equal(l1[2], "#1 Atualizar a altura para 2,10 m");
  assert.equal(l1[4], "Rodada 1");
  assert.equal(l1[5], "Ficha técnica");
  assert.equal(l1[6], "Fazer a alteração\nConferir no mobile\nSubir para o ar");
  assert.equal(linhaPlanner(ws, 3)[0], "Linha 5");
  assert.equal(ws.getRow(8).values && txt(ws, 8, 1), "", "sem linha sobrando");
});

test("descrição da tarefa: blocos em texto simples, sem seção vazia, com a origem no fim", () => {
  const ctx = { cliente: "Vert Portas", rodada: 2, novas: 1, printsPorLinha: new Map([[4, 2]]) };
  const completa = descricaoDaTarefa(
    { linhaOrigem: 4, posicao: 2, grupo: "", solicitacao: "Adicionar os tipos de núcleo", pagina: "https://v.com/c", secao: "ficha", links: "https://d.com/x", obs: "Slide 2." },
    ctx,
  );
  assert.equal(
    completa,
    [
      "O QUE FAZER\nAdicionar os tipos de núcleo",
      "ONDE\nPágina: https://v.com/c\nSeção: ficha",
      "LINKS DO CONTEÚDO\nhttps://d.com/x",
      "OBSERVAÇÕES\nSlide 2.",
      'PRINTS\n2 prints desta alteração (veja o arquivo do briefing, aba "Briefing", ou a pasta de prints).',
      "Briefing: Vert Portas · alteração #2 · linha 4 da planilha",
    ].join("\n\n"),
  );
  const enxuta = descricaoDaTarefa({ linhaOrigem: 7, posicao: 5, grupo: "", solicitacao: "Só isso", pagina: "", secao: "", links: "", obs: "" }, ctx);
  assert.equal(enxuta, "O QUE FAZER\nSó isso\n\nBriefing: Vert Portas · alteração #5 · linha 7 da planilha");
});

test("título da tarefa: primeira linha, numerado e com limite de tamanho", () => {
  assert.equal(tituloDaTarefa({ posicao: 3, solicitacao: "Linha um\nLinha dois" }), "#3 Linha um");
  const longo = tituloDaTarefa({ posicao: 1, solicitacao: "x".repeat(300) });
  assert.ok(longo.length <= 125 && longo.endsWith("…"));
  assert.equal(tituloDaTarefa({ posicao: 1, solicitacao: "  " }), "#1 Sem descrição");
});

test("aba Planner: a descrição fala dos prints quando a alteração tem prints", async () => {
  const buffer = await gerarPlanilha({ templatePath: TEMPLATE, briefing, prints: [{ ordem: 2, buffer: PNG, extensao: "png" }] });
  const ws = (await abrir(buffer)).getWorksheet(ABA_PLANNER)!;
  assert.match(linhaPlanner(ws, 2)[3], /PRINTS\n1 print desta alteração/);
  assert.doesNotMatch(linhaPlanner(ws, 1)[3], /PRINTS/);
});

test("aba Planner: segunda rodada preserva o que já foi enviado/ajustado e só acrescenta o novo (sem duplicar)", async () => {
  const primeira = await gerarPlanilha({ templatePath: TEMPLATE, briefing });
  // o fluxo enviou a linha 3 e alguém ajustou o título e a pasta de prints da linha 4
  const wb0 = await abrir(primeira);
  const ws0 = wb0.getWorksheet(ABA_PLANNER)!;
  ws0.getCell(5, 2).value = ST_ENVIADA;
  ws0.getCell(5, 9).value = "https://tasks.office.com/x/Home/Task/abc";
  ws0.getCell(6, 3).value = "#2 Título ajustado pela analista";
  ws0.getCell(6, 8).value = "https://empresa.sharepoint.com/prints/vert";
  const reaberto = Buffer.from(await wb0.xlsx.writeBuffer());

  const extra = BriefingSchema.parse({
    cliente: "Vert Portas",
    alteracoes: [{ ordem: 1, solicitacao: "Remover o banner antigo", url_pagina: "https://vert.com.br/", secao: "home > banner" }],
  });
  const r = await acrescentarAlteracoes({ arquivo: reaberto, briefing: extra });
  const ws = (await abrir(r.arquivo)).getWorksheet(ABA_PLANNER)!;

  assert.deepEqual([1, 2, 3, 4].map((n) => linhaPlanner(ws, n)[0]), ["Linha 3", "Linha 4", "Linha 5", "Linha 6"], "sem duplicar");
  assert.equal(linhaPlanner(ws, 1)[1], ST_ENVIADA, "o que já foi enviado continua enviado");
  assert.equal(linhaPlanner(ws, 1)[8], "https://tasks.office.com/x/Home/Task/abc");
  assert.equal(linhaPlanner(ws, 2)[2], "#2 Título ajustado pela analista", "ajuste da analista preservado");
  assert.equal(linhaPlanner(ws, 2)[7], "https://empresa.sharepoint.com/prints/vert");
  assert.equal(linhaPlanner(ws, 2)[1], ST_PENDENTE, "o que não foi enviado segue pendente");
  const nova = linhaPlanner(ws, 4);
  assert.equal(nova[1], ST_PENDENTE);
  assert.equal(nova[4], "Rodada 2", "a nova alteração vai para o balde da nova rodada");
  assert.equal(nova[2], "#4 Remover o banner antigo");
});

test("aba Planner: planilha antiga (sem a aba) — o que já existia não vira tarefa, só o novo", async () => {
  const wb0 = await abrir(await gerarPlanilha({ templatePath: TEMPLATE, briefing }));
  wb0.removeWorksheet(wb0.getWorksheet(ABA_PLANNER)!.id);
  const antiga = Buffer.from(await wb0.xlsx.writeBuffer());
  const extra = BriefingSchema.parse({ cliente: "X", alteracoes: [{ ordem: 1, solicitacao: "nova", url_pagina: "https://a.com/", secao: "home" }] });
  const r = await acrescentarAlteracoes({ arquivo: antiga, briefing: extra });
  const ws = (await abrir(r.arquivo)).getWorksheet(ABA_PLANNER)!;
  assert.deepEqual([1, 2, 3].map((n) => linhaPlanner(ws, n)[1]), [ST_EXISTIA, ST_EXISTIA, ST_EXISTIA]);
  assert.equal(linhaPlanner(ws, 4)[1], ST_PENDENTE);
  assert.equal(linhaPlanner(ws, 4)[4], "Rodada 2");
});

test("aba Planner: não é protegida (o fluxo e a analista precisam escrever nela) e o Briefing continua a aba ativa", async () => {
  const wb = await abrir(await gerarPlanilha({ templatePath: TEMPLATE, briefing }));
  assert.ok(!(wb.getWorksheet(ABA_PLANNER) as any).sheetProtection?.sheet);
  assert.equal(wb.views[0].activeTab, wb.worksheets.findIndex((w) => w.name === "Briefing"));
});
