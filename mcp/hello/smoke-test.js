import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverEntry = path.join(__dirname, "index.js");

const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry]
});

const client = new Client(
  { name: "shadertoy-mcp-hello-smoke", version: "0.0.0" },
  { capabilities: {} }
);

await client.connect(transport);

const toolsResult = await client.listTools();
const toolNames = (toolsResult.tools ?? []).map((t) => t.name);
console.log("tools:", toolNames.join(", ") || "(none)");

const result = await client.callTool({
  name: "echo",
  arguments: { text: "hello from smoke test" }
});

console.log("echo result:", JSON.stringify(result, null, 2));

await client.close();
