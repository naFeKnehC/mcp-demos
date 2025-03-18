import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Mock weather data
const mockWeatherData = {
  current: {
    temperature: 20,
    humidity: 45,
    condition: "晴朗",
    windSpeed: "3级",
    aqi: 75,
  },
  forecast: [
    {
      date: "2024-03-20",
      high: 22,
      low: 12,
      condition: "多云",
      windSpeed: "3-4级",
    },
    {
      date: "2024-03-21",
      high: 23,
      low: 13,
      condition: "晴",
      windSpeed: "2-3级",
    },
    {
      date: "2024-03-22",
      high: 21,
      low: 11,
      condition: "小雨",
      windSpeed: "4-5级",
    },
  ],
};

// 创建MCP服务器实例
const server = new McpServer({
  name: "weather-server",
  version: "1.0.0",
});

// 定义获取天气的工具
server.tool(
  "get-weather",
  {
    type: z.enum(["current", "forecast"]).optional(),
  },
  async ({ type = "current" }) => {
    const weather = mockWeatherData;

    if (type === "current") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                data: weather.current,
                message: "实时天气信息获取成功",
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                data: weather.forecast,
                message: "未来3天天气预报获取成功",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// 添加一个提示模板
server.prompt(
  "check-weather",
  { type: z.enum(["current", "forecast"]) },
  ({ type }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `请${type === "current" ? "查询当前天气" : "查询未来天气预报"}`,
        },
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
