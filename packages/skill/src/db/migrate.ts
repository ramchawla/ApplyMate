import { connect, migrate } from "./pgvector";

const client = await connect();
await migrate(client);
await client.end();
console.log("[ApplyMate] pgvector schema migrated");
