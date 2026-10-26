const path = require("node:path");
const {openDatabase,criarUsuario} = require("./app.cjs");

function secret(prompt) {
  if (!process.stdin.isTTY) throw new Error("Execute em um terminal interativo.");
  process.stdout.write(prompt);
  return new Promise((resolve,reject) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const handler = chunk => {
      for (const char of chunk.toString()) {
        if (char === "\r" || char === "\n" || char === "\u0003") {
          process.stdin.removeListener("data",handler);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          if (char === "\u0003") reject(new Error("Cancelado."));
          else resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0,-1);
        else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data",handler);
  });
}
async function main() {
  const db = openDatabase(process.env.DATABASE_FILE || path.join(__dirname,"..","data","villas.sqlite"));
  try {
    if (db.prepare("SELECT id FROM users WHERE role='admin'").get()) throw new Error("Administrador já existe. Use o painel de usuários.");
    const password = await secret("Senha do administrador (mínimo 12 caracteres, entrada oculta): ");
    const confirmation = await secret("Confirme a senha: ");
    if (password !== confirmation) throw new Error("As senhas não conferem.");
    const user = await criarUsuario(db,process.argv[2] || "admin",password,"admin");
    console.log("Administrador criado:",user.username);
  } finally { db.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode=1; });
