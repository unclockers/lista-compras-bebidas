const {openDatabase,criarUsuario,createApp} = require("../server/app.cjs");
async function main() {
  const db = openDatabase(":memory:");
  await criarUsuario(db,"test-admin","test-password-only-long","admin");
  const app = createApp({db,origin:"http://127.0.0.1:8766",secure:false});
  app.listen(8766,"127.0.0.1");
}
main().catch(error => {console.error(error);process.exitCode=1;});
