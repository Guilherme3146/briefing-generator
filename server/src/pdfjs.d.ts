/** O pdfjs-dist não publica tipos para o build "legacy" (o que roda no Node). */
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(src: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    isEvalSupported?: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
    }>;
    destroy(): Promise<void>;
  };
}
