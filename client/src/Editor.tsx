import type { Achado, Alteracao, Veredito } from "./types";

const ROTULO_CONF = {
  alta: "Alta confiança",
  media: "Confiança média: conferir",
  manual: "Trazido por você",
} as const;

type Props = {
  alteracao: Alteracao;
  posicao: number;
  total: number;
  achados: Achado[];
  veredito?: Veredito;
  prints: File[];
  onCampo: (ordem: number, campo: keyof Alteracao, valor: unknown) => void;
  onConfirmar: (irParaProxima: boolean) => void;
  onPrints: (arquivos: File[]) => void;
  onRemoverPrint: (indice: number) => void;
  onRemover: () => void;
  onMover: (direcao: -1 | 1) => void;
  onResolverDuvida: (texto: string) => void;
  onAnterior?: () => void;
  onProxima?: () => void;
};

/**
 * O editor de UMA alteração, em tela cheia na coluna central.
 *
 * Antes eram 26 cards empilhados, com os campos secundários escondidos em
 * "mais campos". Agora só a alteração selecionada aparece, com todos os campos
 * à vista — quem preenche olha para um problema por vez.
 */
export default function Editor({
  alteracao: a,
  posicao,
  total,
  achados,
  veredito,
  prints,
  onCampo,
  onConfirmar,
  onPrints,
  onRemoverPrint,
  onRemover,
  onMover,
  onResolverDuvida,
  onAnterior,
  onProxima,
}: Props) {
  // a trava de confirmação tem UI própria; não repete na lista de achados
  const lista = achados.filter((x) => x.regra !== "NAO_CONFIRMADO");
  const reprovada = veredito && !veredito.executavel;
  const linhaPlanilha = 2 + a.ordem;

  const avancadoTemConteudo = Boolean(a.obs_producao.trim() || a.grupo.trim());
  const daConversa = a.origem === "regra" || a.origem === "regra_editada";

  return (
    <article className="editor" id={`alteracao-${a.ordem}`}>
      <header className="editor-topo">
        <div>
          <h2>
            Alteração {a.ordem} <span className="de">de {total}</span>
          </h2>
          <p className="editor-sub">
            Vai na linha {linhaPlanilha} da planilha
            {a.origem !== "analista" && (
              <span className={`selo ${daConversa ? "regra" : "ia"}`}>
                {a.origem === "ia"
                  ? "sugestão da IA"
                  : a.origem === "ia_editada"
                    ? "IA, editada"
                    : a.origem === "regra"
                      ? "lido da conversa"
                      : "conversa, editado"}
              </span>
            )}
          </p>
        </div>
        <div className="editor-botoes">
          <button className="icone" onClick={() => onMover(-1)} disabled={posicao === 1} title="Subir na ordem">
            ↑
          </button>
          <button className="icone" onClick={() => onMover(1)} disabled={posicao === total} title="Descer na ordem">
            ↓
          </button>
          <button className="icone perigo" onClick={onRemover} title="Remover esta alteração">
            Remover
          </button>
        </div>
      </header>

      {!a.confirmado && (
        <div className={`faixa ${daConversa ? "regra" : "ia"}`}>
          <div>
            <strong>{daConversa ? "Lido da conversa (sem IA)" : "Rascunho da IA"}</strong>
            <span>
              {daConversa
                ? "Confira com o trecho original abaixo. Nada é gerado sem a sua confirmação."
                : "Confira os campos abaixo. Nada é gerado sem a sua confirmação."}
            </span>
          </div>
          <div className="faixa-botoes">
            <button className="primario" onClick={() => onConfirmar(false)}>
              Confirmar
            </button>
            {onProxima && (
              <button className="secundario" onClick={() => onConfirmar(true)}>
                Confirmar e ir para a próxima
              </button>
            )}
          </div>
        </div>
      )}

      {a.fonte && (
        <section className="fonte" aria-label="De onde veio na conversa">
          <div className="fonte-topo">
            <h3>De onde veio na conversa</h3>
            <span className={`conf ${a.fonte.confianca}`}>{ROTULO_CONF[a.fonte.confianca]}</span>
          </div>
          <p className="fonte-motivo">{a.fonte.motivo}</p>
          <ul className="fontes">
            {a.fonte.itens.map((f, i) => (
              <li key={i}>
                <b>
                  {f.quem} · {f.tempo}
                </b>
                <span>{f.trecho}</span>
              </li>
            ))}
          </ul>
          <small>Esses trechos estão destacados no pedido, ao lado.</small>
        </section>
      )}

      {(reprovada || lista.length > 0) && (
        <section className="avisos" aria-label="Pendências desta alteração">
          {reprovada && (
            <div className="aviso trava">
              <span className="tag">a produção vai travar</span>
              <p>{veredito!.motivo}</p>
              {veredito!.pergunta && (
                <p className="pergunta">
                  <strong>Perguntar ao cliente:</strong> {veredito!.pergunta}
                </p>
              )}
            </div>
          )}
          {lista.map((x, i) => {
            const ehDuvida = x.regra === "DUVIDA_DA_IA";
            return (
              <div key={`${x.regra}-${i}`} className={`aviso ${x.severidade}`}>
                <div className="aviso-corpo">
                  <span className="tag">
                    {ehDuvida ? "perguntar" : x.severidade === "erro" ? "pendência" : "aviso"}
                  </span>
                  {x.faq !== "—" && <span className="faq">FAQ {x.faq}</span>}
                  <p>{x.mensagem}</p>
                </div>
                {ehDuvida && (
                  <button
                    className="mini"
                    onClick={() => onResolverDuvida(x.mensagem)}
                    title="Já respondida ou não se aplica: tira esta dúvida da lista"
                  >
                    Resolvida
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <label className="campo">
        <span className="rotulo">
          O que fazer <em>coluna A</em>
        </span>
        <textarea
          rows={5}
          value={a.solicitacao}
          onChange={(e) => onCampo(a.ordem, "solicitacao", e.target.value)}
          placeholder="Diga o que alterar, onde e como. Para troca de texto, escreva o texto final entre aspas."
        />
      </label>

      <div className="dupla">
        <label className="campo">
          <span className="rotulo">
            Página <em>coluna B</em>
          </span>
          <input
            value={a.url_pagina}
            onChange={(e) => onCampo(a.ordem, "url_pagina", e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="campo">
          <span className="rotulo">
            Seção <em>coluna C</em>
          </span>
          <input
            value={a.secao.replace(/\n/g, " / ")}
            onChange={(e) => onCampo(a.ordem, "secao", e.target.value.split(" / ").join("\n"))}
            placeholder="home / banner"
          />
          <small>Caminho dentro da página. Use “ / ” para separar os níveis.</small>
        </label>
      </div>

      <label className="campo">
        <span className="rotulo">
          Link do conteúdo <em>coluna D</em>
        </span>
        <textarea
          rows={2}
          value={a.link_conteudo.join("\n")}
          onChange={(e) =>
            onCampo(a.ordem, "link_conteudo", e.target.value.split("\n").map((l) => l.trim()))
          }
          placeholder="Um link por linha (SharePoint, Drive…)"
        />
      </label>

      <label className="campo">
        <span className="rotulo">
          Observações para a implementação <em>coluna E</em>
        </span>
        <textarea
          rows={3}
          value={a.obs_implementacao}
          onChange={(e) => onCampo(a.ordem, "obs_implementacao", e.target.value)}
          placeholder="Só o que o cliente disse e não coube nos outros campos."
        />
      </label>

      <div className="campo">
        <span className="rotulo">
          Prints <em>vão colados na coluna E, nesta linha</em>
        </span>
        <div className="prints">
          <label className="anexar">
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif"
              multiple
              onChange={(e) => {
                onPrints(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <span>+ Anexar print</span>
          </label>
          {prints.map((f, i) => (
            <span className="chip" key={`${f.name}-${i}`}>
              {f.name}
              <button onClick={() => onRemoverPrint(i)} title="Remover print" aria-label={`Remover ${f.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <details className="avancado" open={avancadoTemConteudo}>
        <summary>
          Opções avançadas
          {avancadoTemConteudo && <span className="ponto" aria-label="tem conteúdo" />}
        </summary>
        <div className="avancado-corpo">
          <label className="campo">
            <span className="rotulo">
              Grupo <em>bloco de alterações</em>
            </span>
            <input
              value={a.grupo}
              onChange={(e) => onCampo(a.ordem, "grupo", e.target.value)}
              placeholder="mudanças na página de produtos"
            />
            <small>Mesmo texto em linhas seguidas vira marcador de início e fim na planilha.</small>
          </label>
          <label className="campo">
            <span className="rotulo">
              Observações de produção <em>coluna F</em>
            </span>
            <textarea
              rows={2}
              value={a.obs_producao}
              onChange={(e) => onCampo(a.ordem, "obs_producao", e.target.value)}
            />
            <small>Quase sempre fica vazio — quem executa preenche depois.</small>
          </label>
        </div>
      </details>

      <footer className="editor-nav">
        <button className="secundario" onClick={onAnterior} disabled={!onAnterior}>
          ← Anterior
        </button>
        <span className="posicao">
          {posicao} / {total}
        </span>
        <button className="secundario" onClick={onProxima} disabled={!onProxima}>
          Próxima →
        </button>
      </footer>
    </article>
  );
}
