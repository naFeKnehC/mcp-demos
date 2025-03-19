import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL_NAME = process.env.OPENAI_MODEL_NAME;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

class MCPClient {
  private mcp: Client;
  private openai: OpenAI;
  private transport: StdioClientTransport | null = null;
  private tools: OpenAI.ChatCompletionTool[] = [];

  constructor() {
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
      baseURL: OPENAI_BASE_URL,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  private validateModelConfig() {
    if (!OPENAI_MODEL_NAME) {
      throw new Error("OPENAI_MODEL_NAME must be set in .env file");
    }
    return OPENAI_MODEL_NAME as string;
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
      this.tools = toolsResult.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      console.log(
        "Connected to server with tools:",
        toolsResult.tools.map(({ name }) => name)
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP 客户端已启动!");
      console.log("输入查询内容或输入 'quit' 退出");

      while (true) {
        const message = await rl.question("\n查询: ");
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

  async processQuery(query: string) {
    const model = this.validateModelConfig();
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    let response = await this.openai.chat.completions.create({
      model: model,
      messages,
      tools: this.tools,
    });

    const message = response.choices[0].message;

    messages.push(message);

    let finalText = "";

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        try {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          const result = await this.mcp.callTool({
            name: toolName,
            arguments: toolArgs,
          });

          finalText += `[调用工具 ${toolName} 参数 ${JSON.stringify(
            toolArgs
          )}]\n`;

          messages.push({
            role: "tool",
            content: JSON.stringify(result.content),
            tool_call_id: toolCall.id,
          });

          response = await this.openai.chat.completions.create({
            model: model,
            messages,
            // tools: this.tools,
          });

          console.log(messages, "messages");
          console.log(response.choices[0].message, "response");

          finalText += response.choices[0].message.content + "\n";
        } catch (error) {
          throw error;
        }
      }
    } else {
      finalText = message.content || "";
    }

    return finalText;
  }

  async cleanup() {
    await this.mcp.close();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log("用法: node index.ts <服务端脚本路径>");
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
