import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const transport = new StdioClientTransport({
  command: "node",
  args: [fileURLToPath(new URL("./index.js", import.meta.url))]
});

const client = new Client({ name: "shadertoy-glslang-smoke", version: "0.0.0" });

await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name));

const version = await client.callTool({ name: "version", arguments: {} });
console.log("version:", version.content?.[0]?.text?.split(/\r?\n/)[0] ?? version);

const goodFrag = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0);
}
`;

const badFrag = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0) // missing semicolon
}
`;

const ok = await client.callTool({
  name: "validate",
  arguments: { source: goodFrag, stage: "frag" }
});
console.log("validate(ok):", ok.content?.[0]?.text?.split(/\r?\n/)[0]);

const bad = await client.callTool({
  name: "validate",
  arguments: { source: badFrag, stage: "frag" }
});
console.log("validate(bad):", bad.content?.[0]?.text?.split(/\r?\n/)[0]);

await client.close();
