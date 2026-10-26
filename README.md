# Villas Beer - Compras e estoque

Aplicativo independente dos sistemas OficcerSeg. Marca fornecida pelo proprietário.
O pedido manual continua disponível; usar contagem de estoque é opcional.

## Situação da publicação

O GitHub Pages anterior (`https://unclockers.github.io/lista-compras-bebidas/`)
é uma aplicação estática sem autenticação. Esta versão adiciona backend real.
Não substituir a versão pública antes de definir a hospedagem HTTPS do backend,
criar o primeiro administrador e conferir a migração dos dados locais.

**GitHub Pages não executa Node nem SQLite.** Neste projeto, o backend serve tanto
a interface quanto a API no mesmo endereço HTTPS. Assim os cookies de sessão não
dependem de permissões de terceiros entre dois domínios.
O Pages pode continuar como uma página de entrada apontando para o endereço seguro.
Não basta colocar senha no JavaScript ou esconder botões.

## Perfis

- **Administrador:** cadastra produtos, categorias e parâmetros; compartilha o
  catálogo; cria/desativa contas; revisa contagens e gera o pedido.
- **Colaborador:** consulta o catálogo, preenche/envia contagens e consulta suas
  próprias contagens. Não altera catálogo, parâmetros, usuários ou pedidos.
- Não há inscrição pública. O primeiro administrador é criado pelo terminal;
  as demais contas são cadastradas pelo administrador em Equipe.
- Senhas: 12 a 128 caracteres, scrypt com salt. Sessão de 8 horas em cookie
  HttpOnly, SameSite=Strict e Secure em produção. Mudar senha/desativar conta
  revoga as sessões. Há limite persistente de tentativas e validação de Origin
  em operações de escrita. Não há senha padrão.

## Catálogo compartilhado e pedido

1. Edite produtos/categorias em Cadastros.
2. Informe a unidade (fardo, caixa, unidade etc.), mínimo e ideal.
3. Use **Salvar catálogo online** para compartilhar com a equipe.
4. Em outro aparelho, recarregue para buscar a revisão atual.

Alterações concorrentes do catálogo são rejeitadas com HTTP 409, em vez de
sobrescrever silenciosamente. Faça backup local antes de descartar conflitos.
O pedido manual e o rascunho de contagem ficam separados por usuário/aparelho.
O histórico local só é salvo pelo botão Salvar no histórico.
Renomear um produto também atualiza seu nome no pedido e no histórico local.

## Contagem opcional

1. O colaborador entra com sua conta e toca em Contar estoque.
2. Usa a mesma unidade configurada para compra. Branco significa **não contado**,
   zero significa **estoque zerado**. Quantidades inteiras de 0 a 999.
3. Ao tocar em Enviar contagem, o servidor grava autor, horário e revisão do
   catálogo, e calcula a reposição. Falha de rede mantém o rascunho no aparelho;
   não há envio automático oculto. Enviar de novo gera outra contagem identificada.
4. O administrador abre Contagens enviadas e revisa a sugestão.
5. Abaixo do mínimo: comprar `ideal - estoque contado`.
   No mínimo ou acima: sem reposição. Itens não contados ou sem unidade/mínimo/ideal
   são pendências, nunca tratados como estoque zero.
6. Somente após aprovação a sugestão substitui o pedido manual, que ainda pode
   ser editado antes de compartilhar pelo WhatsApp.

Exemplo: mínimo 5 fardos, ideal 20, contado 2 → comprar 18 fardos.
As contagens não são somadas entre colaboradores; cada sessão é independente.
Contagens de revisão antiga não geram pedidos no catálogo novo: solicite nova
contagem. Não há conversão automática de caixas em unidades ou frações.

## Offline, privacidade e backup

- Entre com internet. Enquanto a página autenticada estiver aberta, pode editar o
  pedido/contagem offline; enviar ao servidor e WhatsApp exige internet.
- Reabrir/recarregar offline mostra login, não concede acesso usando apenas
  informação do navegador. Não há login offline.
- Logout remove o cache local daquele usuário neste aparelho; baixe backup antes
  de sair se precisar guardar rascunho/histórico. Contagens enviadas ficam no servidor.
- O service worker armazena somente arquivos da interface; nunca respostas `/api/`.
- Backup JSON local não contém senhas. Restauração substitui os dados locais;
  publicar o catálogo restaurado requer ação explícita do administrador.
- Backups v2 da versão anterior são aceitos pelo administrador. Dados de outro
  domínio não migram automaticamente: exporte antes da troca de endereço.
- O repositório é público: o catálogo inicial de exemplo já foi publicado.
  Não versionar contagens, banco SQLite, arquivos `.env`, senhas ou backups.
  Cadastros reais da equipe e contagens são armazenados apenas no banco do servidor.
- Em dispositivos compartilhados, não basta fechar a aba: use Sair. O navegador
  mantém o rascunho local para recuperação até o logout.

## Executar localmente

Requer **Node.js 24 ou superior**. O backend usa SQLite nativo, sem serviço de banco externo.

```powershell
npm.cmd ci
npm.cmd run create-admin -- admin
$env:NODE_ENV="development"
$env:PUBLIC_ORIGIN="http://127.0.0.1:8770"
npm.cmd start
```

O comando create-admin solicita a senha no terminal sem exibi-la, nunca em
argumento de linha de comando ou no chat. Abra `http://127.0.0.1:8770`.
Só usar NODE_ENV=development em testes locais, pois desabilita Secure do cookie.

## Publicação do backend (pendente de autorização do ambiente)

- Processo separado, usuário/serviço separado dos condomínios.
- Node 24+, volume persistente privado para `DATABASE_FILE`, backup SQLite
  consistente (usar API de backup/SQLite, não copiar apenas o arquivo durante escrita).
- `PUBLIC_ORIGIN=https://endereco-do-aplicativo` (sem barra final).
- `PORT=8770`, `DATABASE_FILE=/caminho-privado/villas.sqlite`.
- Não definir NODE_ENV=development em produção.
- Proxy HTTPS encaminha **interface e /api/** ao Node na interface 127.0.0.1.
- Criar administrador no próprio servidor e guardar a senha fora do repositório.
- Não expor a porta local diretamente nem alterar serviços existentes sem aprovação.
- Por padrão o limite de login considera o IP do proxy, sem confiar cegamente
  em X-Forwarded-For. Em proxy compartilhado isso pode limitar vários usuários
  após 15 erros em 15 minutos; revisar a política antes de escalar o uso.
- O workflow de Pages publica somente arquivos estáticos, não implanta o backend.

## Validação

```powershell
npx.cmd playwright install chromium
npm.cmd test
```

Testes de API usam SQLite em memória e senhas exclusivamente de teste, sem criar
usuários no banco real. Cobrem autenticação, permissões, CSRF, limitação de login,
sessões, conflito de catálogo, autoria e cálculo de contagens.
Os testes de navegador sobem/encerram um servidor temporário na porta 8766 e cobrem
cadastros, pedido, backup, contagem, perfis e telas de 320 a 768 pixels.
Não substituem teste no aparelho físico/Safari/WhatsApp e smoke test após publicação.
