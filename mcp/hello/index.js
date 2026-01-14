import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "shadertoy-hello",
  version: "0.0.0"
});

server.tool(
  "echo",
  "Echo back the provided text.",
  {
    text: z.string().describe("Text to echo")
  },
  async ({ text }) => ({
    content: [{ type: "text", text }]
  })
);

server.tool("time", "Return the current server time as an ISO string.", async () => ({
  content: [{ type: "text", text: new Date().toISOString() }]
}));

await server.connect(new StdioServerTransport());
