import JSZip from "jszip";
import { PRIMEIRA_LINHA_DADOS, ULTIMA_LINHA_DADOS } from "./schema.js";

/**
 * As colunas "Val. Implementação" e "Val. Design" (H e I) da planilha de produção são caixas de marcação
 * do Excel 365. O ExcelJS não conhece esse recurso e, ao regravar o arquivo, deixa só VERDADEIRO/FALSO.
 * Aqui o recurso é devolvido por cima do arquivo já gerado: sem ele a produção perde as caixas.
 * Idempotente: se as caixas já estão lá, não muda nada.
 */

const NS_FPB = "http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag";
const PARTE = "xl/featurePropertyBag/featurePropertyBag.xml";
const CONTEUDO_FPB = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<FeaturePropertyBags xmlns="${NS_FPB}"><bag type="Checkbox"/><bag type="XFControls"><bagId k="CellControl">0</bagId></bag><bag type="XFComplement"><bagId k="XFControls">1</bagId></bag><bag type="XFComplements" extRef="XFComplementsMapperExtRef"><a k="MappedFeaturePropertyBags"><bagId>2</bagId></a></bag></FeaturePropertyBags>`;
const EXT_CAIXA = `<extLst><ext uri="{C7286773-470A-42A8-94C5-96B5CB345126}" xmlns:xfpb="${NS_FPB}"><xfpb:xfComplement i="0"/></ext></extLst>`;

/** caminho da planilha "Alteração" dentro do zip, ou null */
async function caminhoDaAba(zip: JSZip, nome: string): Promise<string | null> {
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wb || !rels) return null;
  const esc = nome.normalize("NFC");
  const tag = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => {
    const n = /\bname="([^"]*)"/.exec(t)?.[1] ?? "";
    return n.replace(/&amp;/g, "&").normalize("NFC") === esc;
  });
  const rid = tag && /\br:id="([^"]*)"/.exec(tag)?.[1];
  if (!rid) return null;
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => new RegExp(`\\bId="${rid}"`).test(t));
  const alvo = rel && /\bTarget="([^"]*)"/.exec(rel)?.[1];
  if (!alvo) return null;
  return alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`;
}

export async function garantirCaixasDeMarcacao(arquivo: Buffer, nomeAba = "Alteração"): Promise<Buffer> {
  const zip = await JSZip.loadAsync(arquivo);
  const caminho = await caminhoDaAba(zip, nomeAba);
  const estilos = await zip.file("xl/styles.xml")?.async("string");
  if (!caminho || !estilos || !zip.file(caminho)) return arquivo;
  let aba = await zip.file(caminho)!.async("string");

  // estilos (s) das células H e I da área de dados que ainda não são caixa de marcação
  const celulas = [...aba.matchAll(/<c r="([HI])(\d+)"([^>]*?)(\/?)>/g)].filter((m) => {
    const linha = Number(m[2]);
    return linha >= PRIMEIRA_LINHA_DADOS && linha <= ULTIMA_LINHA_DADOS;
  });
  if (celulas.length === 0) return arquivo;

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilos);
  if (!cellXfs) return arquivo;
  const xfs = [...cellXfs[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
  const ehCaixa = (xf: string) => xf.includes("xfpb:xfComplement");

  const clone = new Map<number, number>(); // estilo antigo -> estilo com caixa
  const novosXfs: string[] = [];
  let alterou = false;
  aba = aba.replace(/<c r="([HI])(\d+)"([^>]*?)(\/?)>/g, (todo, col, lin, attrs: string, fecha: string) => {
    const linha = Number(lin);
    if (linha < PRIMEIRA_LINHA_DADOS || linha > ULTIMA_LINHA_DADOS) return todo;
    const s = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0);
    if (xfs[s] && ehCaixa(xfs[s])) return todo;
    let destino = clone.get(s);
    if (destino === undefined) {
      const base = xfs[s] ?? xfs[0];
      let novo = base.replace(/\/>$/, `>${EXT_CAIXA}</xf>`);
      if (novo === base) novo = base.replace(/<\/xf>$/, `${EXT_CAIXA}</xf>`);
      destino = xfs.length + novosXfs.length;
      novosXfs.push(novo);
      clone.set(s, destino);
    }
    alterou = true;
    const attrsNovos = /\bs="\d+"/.test(attrs) ? attrs.replace(/\bs="\d+"/, `s="${destino}"`) : `${attrs} s="${destino}"`;
    return `<c r="${col}${lin}"${attrsNovos}${fecha}>`;
  });
  if (!alterou) return arquivo;

  const total = xfs.length + novosXfs.length;
  const estilosNovos = estilos.replace(
    /<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,
    (bloco) => bloco.replace(/<cellXfs\b[^>]*>/, `<cellXfs count="${total}">`).replace(/<\/cellXfs>$/, `${novosXfs.join("")}</cellXfs>`),
  );
  zip.file("xl/styles.xml", estilosNovos);
  zip.file(caminho, aba);

  if (!zip.file(PARTE)) {
    zip.file(PARTE, CONTEUDO_FPB);
    const tipos = (await zip.file("[Content_Types].xml")!.async("string")).replace(
      "</Types>",
      `<Override PartName="/${PARTE}" ContentType="application/vnd.ms-excel.featurepropertybag+xml"/></Types>`,
    );
    zip.file("[Content_Types].xml", tipos);
    const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    const ids = [...rels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
    const id = `rId${Math.max(0, ...ids) + 1}`;
    zip.file(
      "xl/_rels/workbook.xml.rels",
      rels.replace(
        "</Relationships>",
        `<Relationship Id="${id}" Type="http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag" Target="featurePropertyBag/featurePropertyBag.xml"/></Relationships>`,
      ),
    );
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
