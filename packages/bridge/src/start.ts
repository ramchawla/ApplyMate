import { createServer } from "./server";
import { OutputStore } from "./store";

const PORT = Number(process.env.APPLYMATE_BRIDGE_PORT ?? 4179);
const store = new OutputStore();
const server = createServer(store);

server.listen(PORT, () => {
  console.log(`[ApplyMate] bridge listening on http://127.0.0.1:${PORT}`);
});
