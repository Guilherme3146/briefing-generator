import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Carrega o .env da raiz do projeto.
 *
 * Mora num modulo proprio de proposito: imports de ES sao avaliados antes do
 * corpo do modulo que importa, entao chamar loadEnvFile() dentro do index.ts
 * aconteceria DEPOIS de ia.ts ja ter lido process.env no topo dele. Qualquer
 * modulo que leia variavel de ambiente em escopo de modulo deve importar este
 * arquivo primeiro.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(__dirname, "..", "..");

try {
  process.loadEnvFile(path.join(RAIZ, ".env"));
} catch {
  /* sem .env — segue com as variaveis do ambiente, modo Fase 1 */
}
