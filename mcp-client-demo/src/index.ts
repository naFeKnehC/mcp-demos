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

  async connectToServer(serverScriptPath: string): Promise<void> {
    const fileExt = serverScriptPath.split(".").pop()?.toLowerCase();
    if (!["js", "py"].includes(fileExt ?? "")) {
      throw new Error("服务器脚本必须是 .js 或 .py 文件");
    }

    const command =
      fileExt === "py"
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;

    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath],
    });

    this.mcp.connect(this.transport);
    await this.initializeTools();
  }

  private async initializeTools(): Promise<void> {
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
      "可用工具:",
      toolsResult.tools.map(({ name }) => name).join(", ")
    );
  }

  async chatLoop(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP 客户端已启动");
      console.log("输入查询内容或输入 'quit' 退出\n");

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

  private async processQuery(query: string): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "user", content: query },
    ];

    // 输入用户问题，调用function call，返回结果
    const response = await this.openai.chat.completions.create({
      model: OPENAI_MODEL_NAME as string,
      messages,
      tools: this.tools,
    });

    const message = response.choices[0].message;

    // 如果message没有tool_calls，则直接返回message.content
    if (!message.tool_calls) {
      return message.content || "";
    }

    // 存在tool_calls，则将message追加进essages，并调用handleToolCalls处理tool_calls
    messages.push(message);
    return this.handleToolCalls(message.tool_calls, messages);
  }

  private async handleToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ): Promise<string> {
    let result = "";

    for (const toolCall of toolCalls) {
      try {
        // 解析函数名和参数
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        console.log(toolArgs, toolCall.function.arguments);

        // 调用mcpserver - function拿到结果
        const toolResult = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });

        // 将结果追加进messages
        messages.push({
          role: "tool",
          content: JSON.stringify(toolResult.content),
          tool_call_id: toolCall.id,
        });

        // 将结果再回给大模型，返回结果
        const followUpResponse = await this.openai.chat.completions.create({
          model: OPENAI_MODEL_NAME as string,
          messages,
          // 使用 deepseek function calling tools暂时无效（与openai存在差异）
          // tools: this.tools,
        });

        result += followUpResponse.choices[0].message.content || "";
      } catch (error) {
        result += `工具调用失败: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }

    return result;
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
  } catch (error) {
    console.error(
      "程序错误:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
