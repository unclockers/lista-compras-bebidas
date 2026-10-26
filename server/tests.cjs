const {test} = require("node:test");
const assert = require("node:assert/strict");
const {openDatabase,criarUsuario,createApp} = require("./app.cjs");
const {calcularReposicao} = require("../estoque.js");
const ORIGIN="http://127.0.0.1:8771";
const password="test-only-password-long";
async function fixture(t,additionalOrigins=[]) {
  const db=openDatabase(":memory:");
  await criarUsuario(db,"admin-test",password,"admin");
  await criarUsuario(db,"colab-test",password,"colaborador");
  const app=createApp({db,origin:ORIGIN,additionalOrigins,secure:false});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+app.address().port;
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));db.close();});
  async function call(route,method="GET",data,cookie,origin=ORIGIN){
    return fetch(base+"/api"+route,{
      method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data?{"Content-Type":"application/json"}:{})},
      body:data?JSON.stringify(data):undefined,
    });
  }
  async function login(username="admin-test"){
    const r=await call("/login","POST",{username,password});
    assert.equal(r.status,200);
    return r.headers.get("set-cookie").split(";")[0];
  }
  return {db,call,login,base};
}
test("reposição: branco não é zero, limiar exato e estoque excedente",()=>{
  const produtos=[["A",0,0],["B",0,0],["C",0,0],["D",0,0]];
  const parametros=Object.fromEntries(produtos.map(([n])=>[n,{minimo:5,ideal:20,unidade:"fardo"}]));
  assert.deepEqual(calcularReposicao(produtos,parametros,{A:0,B:5,C:30}),{
    pedido:{A:20},naoContados:["D"],semParametros:[],
  });
  assert.deepEqual(calcularReposicao([["A",0,0]],{}, {A:2}).semParametros,["A"]);
  assert.throws(()=>calcularReposicao(produtos,parametros,{A:1.5}));
});
test("proteção real: anônimo, CSRF, cookie, sessão e logout",async t=>{
  const {call,login,db}=await fixture(t);
  for(const route of ["/catalog","/counts","/users"])assert.equal((await call(route)).status,401);
  assert.equal((await call("/login","POST",{username:"admin-test",password},"","https://evil.invalid")).status,403);
  const response=await call("/login","POST",{username:"admin-test",password});
  const setCookie=response.headers.get("set-cookie");
  assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
  const cookie=await login();
  assert.equal((await call("/session","GET",undefined,cookie)).status,200);
  assert.equal(db.prepare("SELECT token FROM sessions LIMIT 1").get().token.length,64);
  assert.equal((await call("/logout","POST",{},cookie)).status,200);
  assert.equal((await call("/catalog","GET",undefined,cookie)).status,401);
});
test("origem adicional explícita aceita IP sem liberar outras origens",async t=>{
  const ip="https://107.152.42.52:8444";
  const {call}=await fixture(t,[ip]);
  for(const allowed of [ORIGIN,ip]){
    assert.equal((await call("/login","POST",{username:"admin-test",password},"",allowed)).status,200);
    assert.notEqual((await call("/setup","POST",{},"",allowed)).status,403);
  }
  for(const rejected of ["https://evil.invalid","https://107.152.42.52:8445","http://107.152.42.52:8444","null",""]){
    assert.equal((await call("/login","POST",{username:"admin-test",password},"",rejected)).status,403);
    assert.equal((await call("/setup","POST",{},"",rejected)).status,403);
  }
  const db=openDatabase(":memory:");
  try {
    assert.throws(()=>createApp({db,origin:"https://vigilant.selfip.com:8444",additionalOrigins:["http://107.152.42.52:8444"]}),/HTTPS/);
  } finally { db.close(); }
});
test("colaborador proibido de gerenciar equipe e catálogo; contagens têm autoria real",async t=>{
  const {call,login}=await fixture(t);
  const admin=await login();const colab=await login("colab-test");
  assert.equal((await call("/users","GET",undefined,colab)).status,403);
  assert.equal((await call("/users","POST",{username:"other",password,role:"admin"},colab)).status,403);
  assert.equal((await call("/catalog","PUT",{},colab)).status,403);
  const cat=await(await call("/catalog","GET",undefined,admin)).json();
  cat.parametros["COCA 2LT"]={minimo:5,ideal:20,unidade:"fardo"};
  assert.equal((await call("/catalog","PUT",cat,admin)).status,200);
  const submitted=await call("/counts","POST",{revision:cat.revision+1,itens:{"COCA 2LT":2},username:"falso",pedido:{"COCA 2LT":999}},colab);
  assert.equal(submitted.status,201);
  const payload=await submitted.json();
  assert.equal(payload.username,"colab-test");assert.equal(payload.pedido["COCA 2LT"],18);
  await call("/counts","POST",{revision:cat.revision+1,itens:{"COCA 2LT":0}},admin);
  const own=await(await call("/counts","GET",undefined,colab)).json();
  const all=await(await call("/counts","GET",undefined,admin)).json();
  assert.equal(own.length,1);assert.equal(all.length,2);
  assert.equal((await call("/counts","POST",{revision:cat.revision,itens:{"COCA 2LT":0}},colab)).status,409);
});
test("conflito de catálogo, entradas inválidas e desligamento revogam sessão",async t=>{
  const {call,login}=await fixture(t);const admin=await login();const colab=await login("colab-test");
  const cat=await(await call("/catalog","GET",undefined,admin)).json();
  assert.equal((await call("/catalog","PUT",{...cat,parametros:{"COCA 2LT":{unidade:"fardo",minimo:5,ideal:2}}},admin)).status,400);
  assert.equal((await call("/catalog","PUT",cat,admin)).status,200);
  assert.equal((await call("/catalog","PUT",cat,admin)).status,409);
  assert.equal((await call("/counts","POST",{revision:cat.revision+1,itens:{"COCA 2LT":-1}},colab)).status,400);
  const users=await(await call("/users","GET",undefined,admin)).json();
  const id=users.find(u=>u.role==="colaborador").id;
  assert.equal((await call("/users/"+id,"PATCH",{active:false},admin)).status,200);
  assert.equal((await call("/catalog","GET",undefined,colab)).status,401);
});
test("senhas não são armazenadas em claro e limite de tentativas bloqueia brute force",async t=>{
  const {db,call}=await fixture(t);
  const stored=db.prepare("SELECT password FROM users LIMIT 1").get().password;
  assert.notEqual(stored,password);assert.match(stored,/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  for(let i=0;i<15;i++){
    assert.equal((await call("/login","POST",{username:"admin-test",password:"errada"})).status,401);
  }
  assert.equal((await call("/login","POST",{username:"admin-test",password})).status,429);
});
test("trocar senha exige senha atual e revoga todas as sessões",async t=>{
  const {call,login}=await fixture(t);const admin=await login();
  assert.equal((await call("/password","POST",{current:"errada",password:"test-new-password-long"},admin)).status,403);
  assert.equal((await call("/password","POST",{current:password,password:"curta"},admin)).status,400);
  assert.equal((await call("/password","POST",{current:password,password:"test-new-password-long"},admin)).status,200);
  assert.equal((await call("/session","GET",undefined,admin)).status,401);
  assert.equal((await call("/login","POST",{username:"admin-test",password:"test-new-password-long"})).status,200);
});
test("API nunca é cacheada e arquivos privados não são servidos",async t=>{
  const {base,call,login}=await fixture(t);
  const cookie=await login();
  const catalog=await call("/catalog","GET",undefined,cookie);
  assert.equal(catalog.headers.get("cache-control"),"no-store");
  for(const route of ["/data/villas.sqlite","/server/seed.cjs","/.env","/package.json"]) {
    assert.equal((await fetch(base+route)).status,404);
  }
  const page=await(await fetch(base+"/")).text();
  assert(!page.includes("COCA 2LT"));
});
test("banco persiste usuários, catálogo e contagens após reabertura",async t=>{
  const fs=require("node:fs");const os=require("node:os");const path=require("node:path");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"villas-test-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"db.sqlite");
  let db=openDatabase(filename);
  await criarUsuario(db,"durable",password,"admin");
  db.prepare("INSERT INTO counts(user_id,created,payload) VALUES(?,?,?)").run(1,new Date().toISOString(),JSON.stringify({itens:{"COCA 2LT":0}}));
  db.close();db=openDatabase(filename);
  assert.equal(db.prepare("SELECT username FROM users").get().username,"durable");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM counts").get().total,1);
  assert.equal(db.prepare("SELECT revision FROM catalog").get().revision,1);
  db.close();
});
test("ativação exige código privado, cria admin único e invalida o código",async t=>{
  const fs=require("node:fs");const os=require("node:os");const path=require("node:path");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"villas-setup-"));
  const db=openDatabase(":memory:");const setupFile=path.join(dir,"setup-token");
  const app=createApp({db,origin:ORIGIN,secure:false,setupFile});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base="http://127.0.0.1:"+app.address().port;
  const request=(data)=>fetch(base+"/api/setup",{method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/json"},body:JSON.stringify(data)});
  assert.equal((await(await fetch(base+"/api/setup/status")).json()).required,true);
  assert.equal((await request({code:"invalido",username:"admin",password})).status,403);
  assert.equal((await request({code:fs.readFileSync(setupFile,"utf8"),username:"admin",password})).status,201);
  assert.equal(fs.existsSync(setupFile),false);
  assert.equal((await(await fetch(base+"/api/setup/status")).json()).required,false);
  assert.equal((await request({code:"qualquer",username:"outro",password})).status,404);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM users").get().total,1);
});
