/**
 * Utilidades de imagem sem dependência: formato e tamanho lidos do próprio cabeçalho do arquivo.
 * O ExcelJS só aceita PNG, JPEG e GIF, e precisa do tamanho para não esticar o print.
 */

export type ExtensaoImagem = "png" | "jpeg" | "gif";

/** Formato pelo CONTEÚDO (o tipo que o navegador informa falha: vem vazio, ou "image/jpg", ou .jfif). */
export function extensaoDaImagem(b: Buffer): ExtensaoImagem | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6 && b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  return null;
}

/** Largura e altura em pixels, ou null se o cabeçalho não for legível. */
export function tamanhoDaImagem(b: Buffer): { largura: number; altura: number } | null {
  const ext = extensaoDaImagem(b);
  if (ext === "png" && b.length >= 24) {
    return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
  }
  if (ext === "gif" && b.length >= 10) {
    return { largura: b.readUInt16LE(6), altura: b.readUInt16LE(8) };
  }
  if (ext === "jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marcador = b[i + 1];
      if (marcador === 0xd8 || (marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0x01) {
        i += 2;
        continue;
      }
      const tamanho = b.readUInt16BE(i + 2);
      // SOF0..SOF15, menos DHT (c4), JPG (c8) e DAC (cc)
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
        return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
      }
      i += 2 + tamanho;
    }
  }
  return null;
}

/** Cabe dentro de maxL x maxA mantendo a proporção (e nunca aumenta além do original). */
export function caber(
  tamanho: { largura: number; altura: number } | null,
  maxL: number,
  maxA: number,
): { width: number; height: number } {
  const t = tamanho && tamanho.largura > 0 && tamanho.altura > 0 ? tamanho : { largura: 4, altura: 3 };
  const escala = Math.min(maxL / t.largura, maxA / t.altura, tamanho ? 1 : Infinity);
  return { width: Math.max(1, Math.round(t.largura * escala)), height: Math.max(1, Math.round(t.altura * escala)) };
}
