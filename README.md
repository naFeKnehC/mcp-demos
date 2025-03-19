# MCP Tool 工作流程说明

## 基本概念

- tool 是一个功能性工具
- 每个 tool 都具有特定的功能定位

## 工作流程

1. **用户输入**

   - 用户以自然语言形式提出问题

2. **匹配处理**

   - 大模型分析用户问题
   - 识别并匹配相应的 tool 关键字

3. **执行阶段**

   - 匹配到的 tool 执行预设功能
   - 获取执行结果

4. **结果处理**
   - 大模型对结果进行总结
   - 将处理后的信息返回给用户

## 特殊机制

- 支持递进式调用
  - 在处理过程中可能触发其他 tool
  - 系统会继续匹配和执行新的 tool

# 使用 MCP 比 openai Function calling 的优势

tools 获取与调用

## tools定义方式

- openai 的需要按文档格式定义，其他模型需要重新定义
- mcp 使用规定格式，针对模型写转换函数即可，或使用其他人定义的 tools

## 调用方法不同

- 自己写函数去处理模型返回的函数调用
- 使用 mcp 内置的函数处理方式，可以复用
