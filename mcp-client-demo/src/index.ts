import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;

if (!OPENAI_API_KEY || !OPENAI_MODEL || !OPENAI_BASE_URL) {
  throw new Error("Missing environment variables");
}

class MCPClient {
  private mcp: Client;
  private openai: OpenAI;
  private transport: StdioClientTransport | null = null;
  private tools: any[] = [];

  constructor() {
    this.openai = new OpenAI({
      baseURL: OPENAI_BASE_URL,
      apiKey: OPENAI_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  async connectToServer(serverScriptPath: string) {
    try {
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;

      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      this.mcp.connect(this.transport);

      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      console.log(
        "Connected to server with tools:",
        this.tools.map(({ name }) => name)
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async processQuery(query: string) {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    const response = await this.openai.chat.completions.create({
      model: OPENAI_MODEL as string,
      messages,
      tools: this.tools,
    });

    const finalText = [];
    const toolResults = [];

    const choice = response.choices[0];
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        toolResults.push(result);
        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
        );

        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [toolCall],
        });
        messages.push({
          role: "tool",
          content: result.content as string,
          tool_call_id: toolCall.id,
        });

        const followUpResponse = await this.openai.chat.completions.create({
          model: OPENAI_MODEL as string,
          messages,
        });

        if (followUpResponse.choices[0].message.content) {
          finalText.push(followUpResponse.choices[0].message.content);
        }
      }
    } else if (choice.message.content) {
      finalText.push(choice.message.content);
    }

    return finalText.join("\n");
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcp.close();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node index.ts <path_to_server_script>");
    return;
  }
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();