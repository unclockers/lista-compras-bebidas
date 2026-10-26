const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require("node:crypto");
const { promisify } = require("node:util");
const { readFileSync, mkdirSync, chmodSync, existsSync, writeFileSync, unlinkSync } = require("node:fs");
const path = require("node:path");
const { calcularReposicao } = require("../estoque.js");
const scrypt = promisify(scryptCallback);
const root = path.resolve(__dirname, "..");
const hash = value => createHash("sha256").update(value).digest("hex");
const normalizar = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const inteiro = n => Number.isInteger(n) && n >= 0 && n <= 999;
const objeto = o => o && typeof o === "object" && !Array.isArray(o);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function exigir(ok, status, message) { if (!ok) throw new HttpError(status, message); }
function nomeSeguro(nome) {
  return typeof nome === "string" && nome.trim().length > 0 && nome.length <= 120 &&
    !/[\r\n]/.test(nome) && !["__proto__", "constructor", "prototype"].includes(nome);
}
function validarCatalogo(dados) {
  exigir(objeto(dados), 400, "Catálogo inválido.");
  const {categorias, produtos, parametros} = dados;
  exigir(Array.isArray(categorias) && categorias.length > 0 && categorias.length <= 100 &&
    categorias.every(c => nomeSeguro(c) && c.length <= 60) &&
    new Set(categorias.map(normalizar)).size === categorias.length, 400, "Categorias inválidas.");
  exigir(Array.isArray(produtos) && produtos.length <= 3000 && produtos.every(p =>
    Array.isArray(p) && p.length === 3 && nomeSeguro(p[0]) && Number.isInteger(p[1]) &&
    p[1] >= 0 && p[1] < categorias.length && inteiro(p[2])) &&
    new Set(produtos.map(p => normalizar(p[0]))).size === produtos.length, 400, "Produtos inválidos.");
  exigir(objeto(parametros) && Object.entries(parametros).every(([nome, p]) =>
    produtos.some(pr => pr[0] === nome) && objeto(p) && typeof p.unidade === "string" &&
    p.unidade.length <= 100 && ((p.minimo === null && p.ideal === null) ||
      (inteiro(p.minimo) && inteiro(p.ideal) && p.ideal >= p.minimo))), 400, "Parâmetros inválidos.");
}
async function passwordHash(password) {
  exigir(typeof password === "string" && password.length >= 12 && password.length <= 128,
    400, "Use uma senha entre 12 e 128 caracteres.");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return salt + ":" + key.toString("hex");
}
async function matches(password, stored) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, expected] = stored.split(":");
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}
function openDatabase(filename) {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), {recursive:true, mode:0o700});
  const db = new DatabaseSync(filename);
  if (filename !== ":memory:") chmodSync(filename,0o600);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','colaborador')), active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalog (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS counts (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_limits (
      key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
    );
  `);
  if (!db.prepare("SELECT id FROM catalog WHERE id=1").get()) {
    db.prepare("INSERT INTO catalog VALUES(1,1,?)").run(JSON.stringify(require("./seed.cjs")));
  }
  return db;
}
async function criarUsuario(db, username, password, role) {
  exigir(typeof username === "string" && /^[a-zA-Z0-9._-]{3,40}$/.test(username),
    400, "Usuário deve ter 3 a 40 letras, números, pontos, hífens ou sublinhados.");
  exigir(["admin","colaborador"].includes(role), 400, "Perfil inválido.");
  exigir(!db.prepare("SELECT id FROM users WHERE username=?").get(username.toLowerCase()),
    409, "Nome de usuário já cadastrado.");
  const digest = await passwordHash(password);
  exigir(!db.prepare("SELECT id FROM users WHERE username=?").get(username.toLowerCase()),
    409, "Nome de usuário já cadastrado.");
  const result = db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)")
    .run(username.toLowerCase(),digest,role);
  return {id:Number(result.lastInsertRowid), username:username.toLowerCase(), role, active:1};
}
async function readBody(req) {
  exigir(req.headers["content-type"]?.split(";")[0] === "application/json", 415, "Envie JSON.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    exigir(size <= 1024 * 1024, 413, "Conteúdo excede 1 MB.");
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, "JSON inválido."); }
  exigir(objeto(body), 400, "Envie um objeto JSON.");
  return body;
}
function createApp({db, origin, secure = true, setupFile = null}) {
  exigir(typeof origin === "string" && (origin.startsWith("https://") || !secure),
    500, "Configure PUBLIC_ORIGIN com HTTPS.");
  exigir(new URL(origin).origin === origin,500,"PUBLIC_ORIGIN deve conter somente protocolo, host e porta, sem barra final.");
  const dummy = passwordHash("dummy-login-not-an-account");
  if (setupFile && !db.prepare("SELECT id FROM users WHERE role='admin'").get() && !existsSync(setupFile)) {
    writeFileSync(setupFile,randomBytes(32).toString("hex"),{mode:0o600,flag:"wx"});
  }
  const cookieName = secure ? "__Host-villas_session" : "villas_session";
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    const send = (status, data) => {
      res.writeHead(status, {"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"});
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, origin);
      const route = url.pathname;
      if (!route.startsWith("/api/")) {
        exigir(req.method === "GET" || req.method === "HEAD",405,"Método não permitido.");
        const files = {
          "/":"index.html", "/index.html":"index.html", "/estoque.js":"estoque.js",
          "/manifest.json":"manifest.json", "/icon.svg":"icon.svg", "/logo.jpg":"logo.jpg",
          "/icon-192.png":"icon-192.png", "/icon-512.png":"icon-512.png", "/sw.js":"sw.js",
        };
        const file = files[route];
        exigir(file,404,"Página não encontrada.");
        const types = {html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",json:"application/json",jpg:"image/jpeg",png:"image/png",svg:"image/svg+xml"};
        res.writeHead(200,{"Content-Type":types[file.split(".").pop()],"Cache-Control":"no-cache"});
        res.end(req.method === "HEAD" ? undefined : readFileSync(path.join(root,file)));
        return;
      }
      if (!["GET","HEAD"].includes(req.method)) {
        exigir(req.headers.origin === origin,403,"Origem da requisição não permitida.");
      }
      if (route === "/api/health" && req.method === "GET") { send(200,{status:"ok"}); return; }
      if (route === "/api/setup/status" && req.method === "GET") {
        send(200,{required:Boolean(setupFile && !db.prepare("SELECT id FROM users WHERE role='admin'").get())});
        return;
      }
      if (route === "/api/setup" && req.method === "POST") {
        exigir(setupFile && existsSync(setupFile),404,"Configuração inicial indisponível.");
        exigir(!db.prepare("SELECT id FROM users WHERE role='admin'").get(),409,"Administrador já configurado.");
        const body=await readBody(req);
        const expected=readFileSync(setupFile,"utf8").trim();
        exigir(typeof body.code==="string" && timingSafeEqual(
          Buffer.from(hash(body.code)),Buffer.from(hash(expected))),403,"Código de ativação inválido.");
        const digest=await passwordHash(body.password);
        exigir(typeof body.username==="string" && /^[a-zA-Z0-9._-]{3,40}$/.test(body.username),400,"Usuário inválido.");
        db.exec("BEGIN IMMEDIATE");
        try {
          exigir(!db.prepare("SELECT id FROM users WHERE role='admin'").get(),409,"Administrador já configurado.");
          db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,'admin')").run(body.username.toLowerCase(),digest);
          db.exec("COMMIT");
        } catch(error) { db.exec("ROLLBACK"); throw error; }
        unlinkSync(setupFile);
        send(201,{ok:true}); return;
      }
      if (route === "/api/login" && req.method === "POST") {
        const body = await readBody(req);
        const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
        exigir(username.length <= 40,400,"Usuário inválido.");
        const now = Date.now();
        db.prepare("DELETE FROM login_limits WHERE expires < ?").run(now);
        const keys = ["ip:"+req.socket.remoteAddress, "user:"+username];
        exigir(keys.every(k => (db.prepare("SELECT attempts FROM login_limits WHERE key=?").get(k)?.attempts || 0) < 15),
          429,"Muitas tentativas. Aguarde 15 minutos.");
        for (const key of keys) db.prepare(`INSERT INTO login_limits VALUES(?,1,?)
          ON CONFLICT(key) DO UPDATE SET attempts=attempts+1`).run(key,now+900000);
        const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
        if (!await matches(body.password, user?.password || await dummy) || !user?.active) {
          throw new HttpError(401,"Usuário ou senha inválidos.");
        }
        for (const key of keys) db.prepare("UPDATE login_limits SET attempts=MAX(0,attempts-1) WHERE key=?").run(key);
        const token = randomBytes(32).toString("base64url");
        db.prepare("DELETE FROM sessions WHERE expires < ?").run(now);
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hash(token),user.id,now+8*3600000);
        res.setHeader("Set-Cookie",cookie(token,8*3600));
        send(200,{id:user.id,username:user.username,role:user.role});
        return;
      }
      const raw = req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith(cookieName+"="))?.slice(cookieName.length+1);
      const user = raw && db.prepare(`SELECT u.id,u.username,u.role FROM sessions s
        JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1`).get(hash(raw),Date.now());
      exigir(user,401,"Faça login para continuar.");
      const admin = () => exigir(user.role === "admin",403,"Somente o administrador pode realizar esta ação.");
      if (route === "/api/session" && req.method === "GET") { send(200,user); return; }
      if (route === "/api/logout" && req.method === "POST") {
        db.prepare("DELETE FROM sessions WHERE token=?").run(hash(raw));
        res.setHeader("Set-Cookie",cookie("",0)); send(200,{ok:true}); return;
      }
      if (route === "/api/password" && req.method === "POST") {
        const body = await readBody(req);
        const current = db.prepare("SELECT password FROM users WHERE id=?").get(user.id);
        exigir(await matches(body.current,current.password),403,"Senha atual incorreta.");
        const digest = await passwordHash(body.password);
        db.prepare("UPDATE users SET password=? WHERE id=?").run(digest,user.id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        res.setHeader("Set-Cookie",cookie("",0)); send(200,{ok:true}); return;
      }
      const catalog = () => {
        const row = db.prepare("SELECT revision,payload FROM catalog WHERE id=1").get();
        return {revision:row.revision,...JSON.parse(row.payload)};
      };
      if (route === "/api/catalog" && req.method === "GET") { send(200,catalog()); return; }
      if (route === "/api/catalog" && req.method === "PUT") {
        admin();
        const body = await readBody(req);
        validarCatalogo(body);
        const payload = JSON.stringify({categorias:body.categorias,produtos:body.produtos,parametros:body.parametros});
        const result = db.prepare("UPDATE catalog SET payload=?,revision=revision+1 WHERE id=1 AND revision=?")
          .run(payload,body.revision);
        exigir(Number(result.changes) === 1,409,"Catálogo alterado em outro aparelho. Recarregue antes de editar.");
        send(200,catalog()); return;
      }
      if (route === "/api/counts" && req.method === "POST") {
        const body = await readBody(req);
        const cat = catalog();
        exigir(body.revision === cat.revision,409,"O catálogo mudou. Recarregue e confira a contagem antes de enviar.");
        exigir(objeto(body.itens) && Object.keys(body.itens).length > 0 &&
          Object.entries(body.itens).every(([k,v]) => cat.produtos.some(p=>p[0]===k) && inteiro(v)),
          400,"Contagem inválida. Informe pelo menos um produto contado.");
        const result = calcularReposicao(cat.produtos,cat.parametros,body.itens);
        const payload = {itens:body.itens,revision:cat.revision,...result};
        const created = new Date().toISOString();
        const inserted = db.prepare("INSERT INTO counts(user_id,created,payload) VALUES(?,?,?)").run(user.id,created,JSON.stringify(payload));
        send(201,{id:Number(inserted.lastInsertRowid),created,username:user.username,...payload}); return;
      }
      if (route === "/api/counts" && req.method === "GET") {
        const rows = user.role === "admin"
          ? db.prepare("SELECT c.*,u.username FROM counts c JOIN users u ON c.user_id=u.id ORDER BY c.id DESC LIMIT 100").all()
          : db.prepare("SELECT c.*,u.username FROM counts c JOIN users u ON c.user_id=u.id WHERE c.user_id=? ORDER BY c.id DESC LIMIT 100").all(user.id);
        send(200,rows.map(r => ({id:r.id,created:r.created,username:r.username,...JSON.parse(r.payload)}))); return;
      }
      if (route === "/api/users") {
        admin();
        if (req.method === "GET") { send(200,db.prepare("SELECT id,username,role,active FROM users ORDER BY id").all()); return; }
        if (req.method === "POST") {
          const b = await readBody(req);
          send(201,await criarUsuario(db,b.username,b.password,b.role)); return;
        }
      }
      const userId = route.match(/^\/api\/users\/(\d+)$/);
      if (userId && req.method === "PATCH") {
        admin();
        const id = Number(userId[1]);
        const b = await readBody(req);
        exigir(id !== user.id,400,"Não é permitido desativar ou redefinir a própria conta aqui.");
        exigir(db.prepare("SELECT id FROM users WHERE id=?").get(id),404,"Usuário não encontrado.");
        exigir(typeof b.active === "boolean",400,"Informe o estado ativo do usuário.");
        const digest = b.password ? await passwordHash(b.password) : null;
        if (digest) db.prepare("UPDATE users SET active=?,password=? WHERE id=?").run(Number(b.active),digest,id);
        else db.prepare("UPDATE users SET active=? WHERE id=?").run(Number(b.active),id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
        send(200,{ok:true}); return;
      }
      throw new HttpError(404,"Endpoint não encontrado.");
    } catch (error) {
      if (!(error instanceof HttpError)) console.error("Erro interno da API",error);
      if (!res.headersSent) send(error instanceof HttpError ? error.status : 500,
        {error:error instanceof HttpError ? error.message : "Erro interno. Tente novamente."});
      else res.destroy();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}
module.exports = {openDatabase,criarUsuario,createApp,validarCatalogo};
if (require.main === module) {
  const origin = process.env.PUBLIC_ORIGIN;
  const secure = process.env.NODE_ENV !== "development";
  const filename = process.env.DATABASE_FILE || path.join(root,"data","villas.sqlite");
  const db = openDatabase(filename);
  const app = createApp({db,origin,secure,setupFile:process.env.SETUP_FILE || null});
  const port = Number(process.env.PORT || 8770);
  app.listen(port,"127.0.0.1",() => console.log("Villas Beer ouvindo em 127.0.0.1:"+port));
  const stop = () => app.close(() => { db.close(); process.exit(0); });
  process.on("SIGTERM",stop);
  process.on("SIGINT",stop);
}
