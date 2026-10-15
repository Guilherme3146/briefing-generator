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

/**
 * Na Vercel, a funcao serverless roda com o cwd apontando para a raiz do
 * projeto empacotado (e e ali que `includeFiles` do vercel.json coloca
 * templates/ e server/dist/prompts/) — matematica de __dirname nao e
 * confiavel ali porque o bundler pode mover o arquivo de lugar. Localmente
 * (e no `npm start` tradicional), o __dirname de server/dist/env.js sobe 2
 * niveis ate a raiz do monorepo, que e o que sempre funcionou.
 */
export const RAIZ = process.env.VERCEL
  ? process.cwd()
  : path.resolve(__dirname, "..", "..");

try {
  process.loadEnvFile(path.join(RAIZ, ".env"));
} catch {
  /* sem .env — segue com as variaveis do ambiente, modo Fase 1 */
}
