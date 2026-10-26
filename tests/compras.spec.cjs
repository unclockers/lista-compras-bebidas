const { test, expect } = require("@playwright/test");
const seed = require("../server/seed.cjs");

test.beforeEach(async ({ page }) => {
  const login = await page.request.post("/api/login",{
    headers:{Origin:"http://127.0.0.1:8766"},
    data:{username:"test-admin",password:"test-password-only-long"},
  });
  expect(login.ok()).toBe(true);
  const catalog = await (await page.request.get("/api/catalog")).json();
  const reset = await page.request.put("/api/catalog",{
    headers:{Origin:"http://127.0.0.1:8766"}, data:{...seed,revision:catalog.revision},
  });
  expect(reset.ok()).toBe(true);
  await page.goto("/");
  page.on("dialog", dialog => dialog.accept());
  await expect(page.locator("#app")).toBeVisible();
});

test("pedido, histórico e persistência", async ({ page }) => {
  await page.getByRole("button", { name: "Usar sugestão", exact: true }).click();
  await page.getByRole("button", { name: "Enviar pelo WhatsApp" }).click();
  await expect(page.locator("#textoPedido")).toHaveValue(/^10X - COCA 2LT\n/);
  await page.getByRole("button", { name: "Salvar no histórico" }).click();
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(page.locator("#total")).toContainText("0 produtos");
  await page.getByRole("button", { name: "Repetir último" }).click();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Quantidade de COCA 2LT", exact: true })).toHaveValue("10");
});

test("cadastro, parâmetros e edição sem perder o pedido", async ({ page }) => {
  await page.getByRole("button", { name: "Cadastros", exact: true }).click();
  await page.getByRole("button", { name: "Categorias", exact: true }).click();
  await page.locator("#categoriaNome").fill("Teste categoria");
  await page.locator("#salvarCategoria").click();
  await page.locator("#cadNovoProduto").click();
  await page.locator("#novoNome").fill("Produto teste");
  await page.locator("#novoCat").selectOption({ label: "Teste categoria" });
  await page.locator("#produtoUnidade").fill("Fardo com 12");
  await page.locator("#produtoUsual").fill("8");
  await page.locator("#produtoMinimo").fill("5");
  await page.locator("#produtoIdeal").fill("20");
  await page.locator("#salvarNovo").click();
  await page.locator("#fecharCadastros").click();
  await page.getByRole("button", { name: "Usar sugestão", exact: true }).click();
  await page.getByRole("button", { name: "Cadastros", exact: true }).click();
  await page.locator("#buscaCadastro").fill("produto teste");
  await page.locator("#cadastroProdutos button").click();
  await page.locator("#novoNome").fill("Produto renomeado");
  await page.locator("#salvarNovo").click();
  await page.locator("#fecharCadastros").click();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Quantidade de PRODUTO RENOMEADO", exact: true })).toHaveValue("8");
  const dados = await page.evaluate(() => JSON.parse(localStorage.getItem("villas.usuario.1")));
  expect(dados.parametros["PRODUTO RENOMEADO"]).toEqual({ unidade: "Fardo com 12", minimo: 5, ideal: 20 });
});

test("validação de duplicados e parâmetros inválidos", async ({ page }) => {
  const mensagens = [];
  page.on("dialog", dialog => mensagens.push(dialog.message()));
  await page.locator("#btnNovo").click();
  await page.locator("#novoNome").fill("coca 2lt");
  await page.locator("#salvarNovo").click();
  await expect(page.locator("#dlgNovo")).toBeVisible();
  await page.locator("#novoNome").fill("Produto exclusivo");
  await page.locator("#produtoMinimo").fill("10");
  await page.locator("#produtoIdeal").fill("5");
  await page.locator("#salvarNovo").click();
  expect(mensagens).toContain("Esse produto já existe.");
  expect(mensagens).toContain("Preencha mínimo e ideal juntos. O ideal deve ser maior ou igual ao mínimo.");
});

test("quantidade fracionada é rejeitada sem alterar o pedido", async ({ page }) => {
  const campo = page.getByRole("spinbutton", {name:"Quantidade de COCA 2LT",exact:true});
  await campo.fill("2.5");
  await campo.blur();
  await expect(campo).toHaveValue("0");
});

test("backup exportado é restaurado e arquivo inválido é rejeitado", async ({ page }) => {
  await page.locator("#btnSugestao").click();
  await page.locator("#btnCadastros").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportarBackup").click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  await page.locator("#fecharCadastros").click();
  await page.locator("#btnLimpar").click();
  await page.locator("#btnCadastros").click();
  await page.locator("#arquivoBackup").setInputFiles(backupPath);
  await expect(page.locator("#total")).not.toContainText("0 produtos");
  await page.locator("#arquivoBackup").setInputFiles({
    name: "invalido.json", mimeType: "application/json", buffer: Buffer.from('{"versao":2}')
  });
  await expect(page.locator("#total")).not.toContainText("0 produtos");
});

test("restaura backup antigo sem vincular dados anônimos automaticamente", async ({ page }) => {
  await page.locator("#btnCadastros").click();
  await page.locator("#arquivoBackup").setInputFiles({
    name:"legado.json", mimeType:"application/json",buffer:Buffer.from(JSON.stringify({
      versao:2,categorias:["Legado"],produtos:[["PRODUTO LEGADO",0,3],["COCA 2LT",0,5]],
      parametros:{},qtd:{"PRODUTO LEGADO":3},
      historico:[{data:"2026-10-26T10:00:00Z",itens:{"COCA 2LT":5}}]
    }))
  });
  await page.locator("#fecharCadastros").click();
  await expect(page.getByRole("spinbutton", {name:"Quantidade de PRODUTO LEGADO",exact:true})).toHaveValue("3");
  await page.locator("#btnUltimo").click();
  await expect(page.getByRole("spinbutton", {name:"Quantidade de COCA 2LT",exact:true})).toHaveValue("5");
});

for (const width of [320, 360, 390, 430, 768]) {
  test(`layout sem transbordamento em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".item")).toHaveCount(112);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const plus = await page.locator(".mais").first().boundingBox();
    expect(plus.width).toBeGreaterThanOrEqual(44);
    expect(plus.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/pedido-${width}.png` });
    await page.locator("#btnCadastros").click();
    await page.locator("#cadNovoProduto").click();
    const dialog = await page.locator("#dlgNovo").boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/cadastro-${width}.png` });
  });
}

test("edita offline após login, mas recarregar offline não libera acesso", async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once:true }));
    }
  });
  await context.setOffline(true);
  await page.locator(".mais").first().click();
  await expect(page.getByRole("spinbutton", { name: "Quantidade de COCA 2LT", exact:true })).toHaveValue("1");
  await page.reload();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  await context.setOffline(false);
});

test("contagem opcional gera reposição e mantém pedido manual até aprovação",async({page})=>{
  await page.locator("#btnCadastros").click();
  await page.locator("#buscaCadastro").fill("COCA 2LT");
  await page.locator("#cadastroProdutos button").first().click();
  await page.locator("#produtoUnidade").fill("fardo");
  await page.locator("#produtoMinimo").fill("5");
  await page.locator("#produtoIdeal").fill("20");
  await page.locator("#salvarNovo").click();
  await page.locator("#fecharCadastros").click();
  await page.locator("#btnPublicarCatalogo").click();
  await expect(page.locator("#btnPublicarCatalogo")).not.toContainText("pendente");
  await page.locator("#btnContagem").click();
  await page.getByRole("spinbutton",{name:"Estoque de COCA 2LT",exact:true}).fill("2");
  await page.getByRole("spinbutton",{name:"Estoque de COCA 2LT",exact:true}).blur();
  await page.locator("#gerarContagem").click();
  await expect(page.locator("#textoReposicao")).toHaveValue("18X - COCA 2LT");
  await expect(page.locator("#total")).toContainText("0 produtos");
  await page.locator("#aprovarReposicao").click();
  await expect(page.getByRole("spinbutton",{name:"Quantidade de COCA 2LT",exact:true})).toHaveValue("18");
  await page.locator("#btnContagem").click();
  await page.locator("#enviarContagem").click();
  await expect(page.locator("#dlgContagem")).not.toBeVisible();
  await page.locator("#btnContagens").click();
  await expect(page.locator("#listaContagens")).toContainText("1 contados");
});

test("colaborador vê contagem, não vê cadastros e não acessa catálogo por PUT",async({page})=>{
  const nome="colab-"+Date.now();
  const created=await page.request.post("/api/users",{
    headers:{Origin:"http://127.0.0.1:8766"},
    data:{username:nome,password:"test-colab-password-long",role:"colaborador"},
  });
  expect(created.status()).toBe(201);
  await page.locator("#btnSair").click();
  await page.locator("#usuarioLogin").fill(nome);
  await page.locator("#senhaLogin").fill("test-colab-password-long");
  await page.locator("#formLogin button").click();
  await expect(page.locator("#btnContagem")).toBeVisible();
  await expect(page.locator("#btnCadastros")).toBeHidden();
  await expect(page.locator("#btnUsuarios")).toBeHidden();
  const denied=await page.request.put("/api/catalog",{
    headers:{Origin:"http://127.0.0.1:8766"},data:{...seed,revision:1},
  });
  expect(denied.status()).toBe(403);
  await page.locator("#btnContagem").click();
  const campo=page.getByRole("spinbutton",{name:"Estoque de COCA 2LT",exact:true});
  await campo.fill("0");await campo.blur();
  await page.locator("#enviarContagem").click();
  await expect(page.locator("#dlgContagem")).not.toBeVisible();
  await page.locator("#btnContagens").click();
  await expect(page.locator("#listaContagens")).toContainText(nome);
});
