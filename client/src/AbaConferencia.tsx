import {
  ROTULO_SITUACAO,
  situacaoDe,
  type Achado,
  type Alteracao,
  type RespostaPerguntas,
  type Veredito,
} from "./types";

type Props = {
  alteracoes: Alteracao[];
  achados: Achado[];
  vereditoDe: (a: Alteracao) => Veredito | undefined;
  perguntas: RespostaPerguntas | null;
  copiado: boolean;
  onMontar: () => void;
  onCopiar: () => void;
  onTextoPerguntas: (texto: string) => void;
  onAbrir: (ordem: number) => void;
};

export default function AbaConferencia({
  alteracoes,
  achados,
  vereditoDe,
  perguntas,
  copiado,
  onMontar,
  onCopiar,
  onTextoPerguntas,
  onAbrir,
}: Props) {
  const linhas = alteracoes
    .map((a) => {
      const dela = achados.filter((x) => x.ordem === a.ordem);
      const veredito = vereditoDe(a);
      return { a, dela, veredito, sit: situacaoDe(a, dela, veredito) };
    })
    .filter((l) => l.sit !== "ok");

  // o rascunho sem confirmar já tem o próprio cartão ("a confirmar")
  const pendencias = achados.filter(
    (x) => x.severidade === "erro" && x.regra !== "NAO_CONFIRMADO",
  ).length;
  const avisos = achados.filter((x) => x.severidade === "aviso").length;
  const rascunhos = alteracoes.filter((a) => !a.confirmado).length;
  const travam = alteracoes.filter((a) => vereditoDe(a)?.executavel === false).length;

  return (
    <div className="pagina">
      <div className="resumo-cartoes">
        <Cartao valor={pendencias} rotulo="pendências" tom={pendencias ? "erro" : "ok"} dica="Bloqueiam a geração" />
        <Cartao valor={avisos} rotulo="avisos" tom={avisos ? "aviso" : "neutro"} dica="Não bloqueiam" />
        <Cartao valor={rascunhos} rotulo="a confirmar" tom={rascunhos ? "ia" : "neutro"} dica="Rascunhos da IA" />
        {travam > 0 && (
          <Cartao valor={travam} rotulo="travam" tom="aviso" dica="Reprovadas na revisão da IA" />
        )}
      </div>

      <div className="duas-colunas">
        <section className="painel">
          <header className="painel-topo">
            <h2>O que falta resolver</h2>
            <p>Clique numa alteração para abrir o editor nela.</p>
          </header>

          {linhas.length === 0 ? (
            <div className="tudo-certo">
              <strong>Tudo certo por aqui.</strong>
              <span>Nenhuma pendência, aviso ou rascunho em aberto.</span>
            </div>
          ) : (
            <ul className="problemas">
              {linhas.map(({ a, dela, veredito, sit }) => (
                <li key={a.ordem}>
                  <button className="problema" onClick={() => onAbrir(a.ordem)}>
                    <span className={`bolinha ${sit}`} />
                    <span className="problema-corpo">
                      <strong>
                        {a.ordem}. {a.solicitacao.trim().slice(0, 90) || "sem descrição"}
                      </strong>
                      <small>{ROTULO_SITUACAO[sit]}</small>
                      <ul>
                        {veredito && !veredito.executavel && <li>{veredito.motivo}</li>}
                        {dela
                          .filter((x) => x.regra !== "NAO_CONFIRMADO")
                          .map((x, i) => (
                            <li key={i}>{x.mensagem}</li>
                          ))}
                      </ul>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="painel">
          <header className="painel-topo">
            <h2>Perguntas para o cliente</h2>
            <p>
              Junta as dúvidas e as lacunas que só o cliente responde, numa mensagem pronta para
              copiar. Monta sozinho, sem IA.
            </p>
          </header>

          <button className="primario" onClick={onMontar}>
            {perguntas ? "Montar de novo" : "Montar perguntas"}
          </button>

          {perguntas &&
            (perguntas.itens.length === 0 ? (
              <div className="tudo-certo">
                <strong>Nada a perguntar.</strong>
                <span>O briefing está fechado.</span>
              </div>
            ) : (
              <>
                <div className="perguntas-topo">
                  <strong>
                    {perguntas.itens.length}{" "}
                    {perguntas.itens.length === 1 ? "pergunta" : "perguntas"}
                  </strong>
                  <button className="secundario" onClick={onCopiar}>
                    {copiado ? "Copiado ✓" : "Copiar mensagem"}
                  </button>
                </div>
                <textarea
                  className="perguntas-texto"
                  rows={14}
                  value={perguntas.texto}
                  onChange={(e) => onTextoPerguntas(e.target.value)}
                />
                <small className="nota">Pode editar o texto antes de copiar.</small>
              </>
            ))}
        </section>
      </div>
    </div>
  );
}

function Cartao({
  valor,
  rotulo,
  tom,
  dica,
}: {
  valor: number;
  rotulo: string;
  tom: "ok" | "aviso" | "erro" | "ia" | "neutro";
  dica: string;
}) {
  return (
    <div className={`cartao ${tom}`} title={dica}>
      <strong>{valor}</strong>
      <span>{rotulo}</span>
    </div>
  );
}
