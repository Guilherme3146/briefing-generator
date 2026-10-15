import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Toasts — aviso curto que aparece e some sozinho, para ações que não têm
 * outro feedback visível (copiar, confirmar, limpar, gerar o arquivo).
 *
 * De propósito, NÃO substitui o `.erro-geral` fixo no topo: erro de chamada à
 * API continua lá, porque o analista precisa poder voltar e reler depois — um
 * toast que sumiu sozinho não serve para isso. Toast é só para "deu certo,
 * siga em frente".
 */

export type TomToast = "sucesso" | "erro" | "info";

type Toast = { id: number; mensagem: string; tom: TomToast };

type ContextoToast = {
  mostrar: (mensagem: string, tom?: TomToast) => void;
};

const Contexto = createContext<ContextoToast | null>(null);

const DURACAO_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(1);

  const remover = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const mostrar = useCallback(
    (mensagem: string, tom: TomToast = "sucesso") => {
      const id = proximoId.current++;
      setToasts((t) => [...t, { id, mensagem, tom }]);
      window.setTimeout(() => remover(id), DURACAO_MS);
    },
    [remover],
  );

  return (
    <Contexto.Provider value={{ mostrar }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tom}`}>
            <span>{t.mensagem}</span>
            <button aria-label="Fechar aviso" onClick={() => remover(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

/** Fora de um <ToastProvider>, vira no-op — nunca quebra a tela por causa de um aviso. */
export function useToast(): ContextoToast {
  const ctx = useContext(Contexto);
  if (ctx) return ctx;
  return { mostrar: () => {} };
}
