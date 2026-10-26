# Lista de compras de bebidas

Marca Villas Beer aplicada com a imagem fornecida pelo proprietário.

**Atenção:** esta versão de Pages continua pública, sem login e com dados locais.
A versão com backend autenticado e contagem compartilhada está na branch
`feat/villas-equipe-estoque`, aguardando definição da hospedagem HTTPS.
Não misturar dados reais da equipe ou estoque no código público.

Aplicativo independente dos sistemas OficcerSeg, hospedável no GitHub Pages.

Site: https://unclockers.github.io/lista-compras-bebidas/

## Uso

- Monte o pedido pelos botões +/− ou digite as quantidades.
- Cadastros permite adicionar/editar produtos, categorias, unidade de compra,
  quantidade usual, estoque mínimo e ideal.
- Mínimo e ideal são opcionais e devem estar na mesma unidade do pedido.
  Por exemplo: mínimo 5 fardos e ideal 20 fardos.
- Sugestões iniciais são valores estimados, editáveis, não uma previsão de consumo.
- Em Cadastros, baixe um backup antes de trocar de celular ou limpar o navegador.
  A restauração substitui os dados locais; faça um backup antes.
- O histórico só é salvo quando você toca em Salvar no histórico, não ao abrir o WhatsApp.
- Renomear um produto também atualiza seu nome no pedido e no histórico local.

## Limites importantes

Dados ficam no navegador de cada aparelho, não no GitHub. Não há login,
sincronização nem contagem compartilhada nesta etapa. Backups contêm os dados
dos pedidos e não devem ser adicionados ao repositório público.
O catálogo inicial e as quantidades usuais no código são públicos no GitHub Pages.

O modo offline exige abrir o site com internet uma primeira vez em HTTPS.
No Android use Instalar/Adicionar à tela inicial pelo navegador; no iPhone,
Safari → Compartilhar → Adicionar à Tela de Início.
Enviar pelo WhatsApp exige conexão, mesmo que o pedido tenha sido montado offline.

## Segunda etapa: contagem opcional por colaboradores

Os parâmetros estão cadastráveis, mas a contagem ainda não está implementada.
O modo manual deve continuar independente.

Fluxo proposto:
1. Administrador configura unidade, mínimo e ideal por produto.
2. Colaborador identificado inicia uma sessão de contagem, com data/hora.
3. Quantidade em branco significa não contado; zero significa estoque zerado.
4. Para itens contados abaixo do mínimo, sugerir `ideal - estoque contado`.
   No mínimo ou acima, não sugerir reposição. Itens sem parâmetros ficam pendentes.
5. Responsável revisa a sugestão e aprova o pedido antes de enviar ao fornecedor.

Para vários aparelhos, adicionar backend autenticado com perfis de administrador
e colaborador, armazenamento compartilhado, sincronização offline e resolução de
conflitos. GitHub Pages continuará hospedando apenas o frontend. Não colocar
chaves administrativas no JavaScript público.

## Desenvolvimento e publicação

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd test
```

Os testes abrem um servidor local temporário na porta 8766 e cobrem cadastros,
pedido, persistência, migração, backup, modo offline e telas de 320 a 768 pixels.
Não substituem homologação em aparelho físico, Safari ou compartilhamento WhatsApp.

O workflow [.github/workflows/pages.yml](.github/workflows/pages.yml) publica só
os quatro arquivos do aplicativo. Configure Pages para GitHub Actions e use
a branch main. Histórico e backups locais não são publicados.
