(function (root) {
  function calcularReposicao(produtos, parametros, contagem) {
    const pedido = {};
    const naoContados = [];
    const semParametros = [];
    for (const [nome] of produtos) {
      if (!Object.hasOwn(contagem, nome)) { naoContados.push(nome); continue; }
      const valor = contagem[nome];
      if (!Number.isInteger(valor) || valor < 0 || valor > 999) {
        throw new Error("Contagem inválida para " + nome);
      }
      const p = parametros[nome];
      if (!p || !p.unidade?.trim() || !Number.isInteger(p.minimo) ||
          !Number.isInteger(p.ideal) || p.minimo < 0 || p.ideal < p.minimo || p.ideal > 999) {
        semParametros.push(nome); continue;
      }
      if (valor < p.minimo) pedido[nome] = p.ideal - valor;
    }
    return {pedido, naoContados, semParametros};
  }
  const api = {calcularReposicao};
  if (typeof module !== "undefined") module.exports = api;
  else root.Estoque = api;
})(globalThis);
