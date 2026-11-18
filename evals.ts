//evals.ts

import { createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { pathToFileURL } from "node:url";

export interface EvalResult {
  accuracy: number;
  completeness: number;
  relevance: number;
  clarity: number;
  reasoning: number;
  overall_comments: string;
}

export interface EvalFunction {
  name: string;
  description: string;
  run: (model: LanguageModel, serverPath: string) => Promise<EvalResult>;
}

export interface EvalConfig {
  model: LanguageModel;
  evals: EvalFunction[];
}

const EVAL_SYSTEM_PROMPT =
  "You are an assistant responsible for evaluating the results of calling various tools. Given the user's query, use the tools available to you to answer the question.";

const GRADING_SYSTEM_PROMPT = `You are an expert evaluator assessing how well an LLM answers a given question. Review the provided answer and score it from 1 to 5 in each of the following categories:
        Accuracy - Does the answer contain factual errors or hallucinations?
        Completeness - Does the answer fully address all parts of the question?
        Relevance - Is the information directly related to the question?
        Clarity - Is the explanation easy to understand and well-structured?
        Reasoning - Does the answer show logical thinking or provide evidence or rationale?
        Return your evaluation as a JSON object in the format:
        {
            "accuracy": 1-5,
            "completeness": 1-5,
            "relevance": 1-5,
            "clarity": 1-5,
            "reasoning": 1-5,
            "overall_comments": "A short paragraph summarizing the strengths and weaknesses of the answer."
        }`;

function getServerEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

async function runEvals(
  model: LanguageModel,
  prompt: string,
  serverPath: string,
): Promise<string> {
  const transport = new StdioMCPTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverPath],
    env: getServerEnv(),
  });
  const client = await createMCPClient({ transport });

  try {
    const tools = await client.tools();
    const result = await generateText({
      model,
      tools,
      system: EVAL_SYSTEM_PROMPT,
      prompt,
      maxRetries: 1,
      stopWhen: stepCountIs(10),
    });
    return result.text;
  } finally {
    await client.close();
  }
}

export async function grade(
  model: LanguageModel | undefined,
  prompt: string,
  serverPath: string,
): Promise<string> {
  const evalModel = model ?? openai("gpt-4o");
  const answer = await runEvals(evalModel, prompt, serverPath);
  const evalPrompt = `Here is the user input: ${prompt}
  Here is the LLM's answer: ${answer}`;
  const result = await generateText({
    model: evalModel,
    maxRetries: 1,
    system: GRADING_SYSTEM_PROMPT,
    prompt: evalPrompt,
  });
  return result.text;
}

export async function runAllEvals(
  config: EvalConfig,
  serverPath: string,
): Promise<Map<string, unknown>> {
  const results = new Map<string, unknown>();

  for (const evaluation of config.evals) {
    console.log(`Running ${evaluation.name}...`);
    try {
      const result = await evaluation.run(config.model, serverPath);
      results.set(evaluation.name, result);
    } catch (error) {
      console.error(`Error running ${evaluation.name}:`, error);
      results.set(evaluation.name, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

const mysqlQueryToolEval: EvalFunction = {
  name: "mysql_query Tool Evaluation",
  description: "Evaluates the MySQL query execution functionality",
  run: async (model, serverPath) => {
    const result = await grade(
      model,
      "Please execute the following SQL query and return the results: SELECT * FROM employees WHERE status='ACTIVE';",
      serverPath,
    );
    return JSON.parse(result);
  },
};

const mysqlQueryGenerationEval: EvalFunction = {
  name: "mysql_query Tool Generation Evaluation",
  description: "Evaluates the MySQL query tool for correct SQL generation and execution",
  run: async (model, serverPath) => {
    const result = await grade(
      model,
      "Use the mysql_query tool to select all rows from the 'users' table where isActive = 1. Provide the SQL query in the correct format.",
      serverPath,
    );
    return JSON.parse(result);
  },
};

const mysqlQueryColumnsEval: EvalFunction = {
  name: "mysql_query Columns Evaluation",
  description: "Evaluates the mysql_query tool for column selection",
  run: async (model, serverPath) => {
    const result = await grade(
      model,
      "Please provide a SQL query to retrieve the id, name, and email columns for all records in the users table.",
      serverPath,
    );
    return JSON.parse(result);
  },
};

const config: EvalConfig = {
  model: openai("gpt-4"),
  evals: [mysqlQueryToolEval, mysqlQueryGenerationEval, mysqlQueryColumnsEval],
};

export default config;

export const evals = [
  mysqlQueryToolEval,
  mysqlQueryGenerationEval,
  mysqlQueryColumnsEval,
];

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const serverPath = process.argv[2] ?? "index.ts";
  runAllEvals(config, serverPath)
    .then((results) => {
      console.log(JSON.stringify(Object.fromEntries(results), null, 2));
    })
    .catch((error) => {
      console.error("Error running evals:", error);
      process.exitCode = 1;
    });
}
