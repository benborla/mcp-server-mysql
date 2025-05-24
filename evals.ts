//evals.ts

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const mysqlQueryToolEval: EvalFunction = {
    name: 'mysql_query Tool Evaluation',
    description: 'Evaluates the MySQL query execution functionality',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please execute the following SQL query and return the results: SELECT * FROM employees WHERE status='ACTIVE';");
        return JSON.parse(result);
    }
};

const mysqlQueryGenerationEval: EvalFunction = {
    name: 'mysql_query Tool Generation Evaluation',
    description: 'Evaluates the MySQL query tool for correct SQL generation and execution',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Use the mysql_query tool to select all rows from the 'users' table where isActive = 1. Provide the SQL query in the correct format.");
        return JSON.parse(result);
    }
};

const mysqlQueryColumnsEval: EvalFunction = {
    name: 'mysql_query Columns Evaluation',
    description: 'Evaluates the mysql_query tool for column selection',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please provide a SQL query to retrieve the id, name, and email columns for all records in the users table.");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [mysqlQueryToolEval, mysqlQueryGenerationEval, mysqlQueryColumnsEval]
};
  
export default config;
  
export const evals = [mysqlQueryToolEval, mysqlQueryGenerationEval, mysqlQueryColumnsEval];