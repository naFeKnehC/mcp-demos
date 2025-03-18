import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";

// 验证环境变量
const OPENAI_API_KEY = "";
const OPENAI_MODEL = "";
const OPENAI_BASE_URL = "";

if (!OPENAI_API_KEY) {
  throw new Error("缺失API密钥，请在.env文件中设置OPENAI_API_KEY");
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
    const isJs = serverScriptPath.endsWith(".js");
    const isPy = serverScriptPath.endsWith(".py");
    if (!isJs && !isPy) {
      throw new Error("服务器脚本必须是.js或.py文件");
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
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      };
    });

    console.log(
      "已连接服务器，可用工具:",
      this.tools.map((tool) => tool.function.name).join(", ")
    );
  }

  async processQuery(query: string) {
    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: query,
        },
      ];

      const response = await this.openai.chat.completions.create({
        model: OPENAI_MODEL as string,
        messages,
        tools: this.tools.length > 0 ? this.tools : undefined,
      });

      const finalText = [];

      const choice = response.choices[0];
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        for (const toolCall of choice.message.tool_calls) {
          try {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            const result = await this.mcp.callTool({
              name: toolName,
              arguments: toolArgs,
            });

            finalText.push(`[调用工具: ${toolName}]`);

            messages.push({
              role: "assistant",
              content: null,
              tool_calls: [toolCall],
            });

            messages.push({
              role: "tool",
              content: JSON.stringify(result.content),
              tool_call_id: toolCall.id,
            });

            const followUpResponse = await this.openai.chat.completions.create({
              model: OPENAI_MODEL as string,
              messages,
            });

            if (followUpResponse.choices[0].message.content) {
              finalText.push(followUpResponse.choices[0].message.content);
            }
          } catch (error) {
            finalText.push(`[工具调用失败: ${toolCall.function.name}]`);
          }
        }
      } else if (choice.message.content) {
        finalText.push(choice.message.content);
      }

      return finalText.join("\n");
    } catch (error: any) {
      if (error?.status === 401) {
        return "API认证失败: 请检查API密钥是否有效";
      } else if (error?.status === 400) {
        return `API请求错误: ${error.message}`;
      } else {
        return `处理查询时出错: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP客户端已启动");
      console.log("输入问题开始对话，输入'quit'退出");

      while (true) {
        const message = await rl.question("\n问题: ");
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
    if (this.mcp) {
      await this.mcp.close();
    }
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log("用法: node index.ts <服务器脚本路径>");
    return;
  }

  const mcpClient = new MCPClient();

  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } catch (error) {
    console.error(
      `程序运行错误: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await mcpClient.cleanup();
  }
}

main();
