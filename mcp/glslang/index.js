import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function getValidatorCommand() {
  return process.env.GLSLANG_VALIDATOR_PATH?.trim() || "glslangValidator";
}

function stageToExtension(stage) {
  switch (stage) {
    case "vert":
      return ".vert";
    case "frag":
      return ".frag";
    case "comp":
      return ".comp";
    case "tesc":
      return ".tesc";
    case "tese":
      return ".tese";
    case "geom":
      return ".geom";
    default:
      return ".glsl";
  }
}

function parseDiagnostics(text) {
  const diagnostics = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const headerMatch = /^(?<severity>ERROR|WARNING):\s*(?<rest>.*)$/.exec(line);
    if (!headerMatch?.groups) continue;

    const severity = headerMatch.groups.severity.toLowerCase();
    const rest = headerMatch.groups.rest;

    // Use greedy match for file to support Windows drive letters.
    const locMatch = /^(?<file>.*):(?<line>\d+):(?:(?<column>\d+):)?\s*(?<message>.*)$/.exec(rest);

    if (locMatch?.groups) {
      diagnostics.push({
        severity,
        file: locMatch.groups.file,
        line: Number(locMatch.groups.line),
        column: locMatch.groups.column ? Number(locMatch.groups.column) : undefined,
        message: locMatch.groups.message
      });
    } else {
      diagnostics.push({ severity, message: rest });
    }
  }

  return diagnostics;
}

async function runValidator(args) {
  const command = getValidatorCommand();

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || String(error),
        error
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr
      });
    });
  });
}

const server = new McpServer({
  name: "shadertoy-glslang",
  version: "0.0.0"
});

server.tool(
  "version",
  "Return glslangValidator version strings.",
  async () => {
    const result = await runValidator(["-v"]);
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return {
      content: [
        {
          type: "text",
          text: text || "glslangValidator produced no output."
        }
      ]
    };
  }
);

server.tool(
  "validate",
  "Validate GLSL/ESSL source using glslangValidator and return diagnostics.",
  {
    source: z.string().describe("Shader source code"),
    stage: z
      .enum(["vert", "frag", "comp", "tesc", "tese", "geom"])
      .default("frag")
      .describe("Shader stage"),
    glslVersion: z
      .enum([
        "100",
        "110",
        "120",
        "130",
        "140",
        "150",
        "300es",
        "310es",
        "320es",
        "330",
        "400",
        "410",
        "420",
        "430",
        "440",
        "450",
        "460"
      ])
      .optional()
      .describe("Override GLSL version (maps to --glsl-version)") ,
    entryPoint: z.string().optional().describe("Entry point function name (-e)") ,
    includeDirs: z.array(z.string()).optional().describe("Include directories (-I)") ,
    macros: z.record(z.string()).optional().describe("Preprocessor macros (-Dname=value)") ,
    extraArgs: z.array(z.string()).optional().describe("Extra raw glslangValidator args")
  },
  async ({ source, stage, glslVersion, entryPoint, includeDirs, macros, extraArgs }) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-glslang-"));
    const filePath = path.join(tmpDir, `shader${stageToExtension(stage)}`);

    try {
      await fs.writeFile(filePath, source, "utf8");

      const args = [
        "--enhanced-msgs",
        "--error-column",
        "--absolute-path",
        "--quiet",
        "-S",
        stage
      ];

      if (glslVersion) {
        args.push("--glsl-version", glslVersion);
      }

      if (entryPoint) {
        args.push("-e", entryPoint);
      }

      for (const dir of includeDirs ?? []) {
        args.push(`-I${dir}`);
      }

      if (macros) {
        for (const [name, value] of Object.entries(macros)) {
          // Note: allow empty string value to mean "-DNAME".
          if (value === "") {
            args.push(`-D${name}`);
          } else {
            args.push(`-D${name}=${value}`);
          }
        }
      }

      if (extraArgs?.length) {
        args.push(...extraArgs);
      }

      args.push(filePath);

      const result = await runValidator(args);
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      const diagnostics = parseDiagnostics(combined);

      const summary = result.ok
        ? `OK (${diagnostics.length} diagnostics)`
        : `FAILED (${diagnostics.length} diagnostics, exitCode=${result.exitCode ?? "null"})`;

      const payload = {
        ok: result.ok,
        exitCode: result.exitCode,
        diagnostics,
        raw: combined
      };

      return {
        content: [
          {
            type: "text",
            text: `${summary}\n\n${JSON.stringify(payload, null, 2)}`
          }
        ]
      };
    } finally {
      // Best-effort cleanup.
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
);

await server.connect(new StdioServerTransport());
