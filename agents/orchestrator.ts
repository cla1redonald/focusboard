#!/usr/bin/env tsx
/**
 * FocusBoard Agent Orchestrator
 *
 * Runs a multi-agent workflow with 6 specialized agents:
 * - Architect: System design and technical decisions
 * - Engineer: Code implementation
 * - UX/UI: Design consistency and accessibility
 * - Researcher: Technical research and evaluation
 * - Tester: Quality assurance and testing
 * - TechAuthor: Documentation updates
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your_key npx tsx orchestrator.ts "Add dark mode toggle"
 */

import Anthropic from "@anthropic-ai/sdk";
import { agents, AgentDefinition } from "./definitions.js";
import * as readline from "readline";

const client = new Anthropic();

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

const agentColors: Record<string, string> = {
  architect: colors.blue,
  engineer: colors.green,
  uxui: colors.magenta,
  researcher: colors.cyan,
  tester: colors.yellow,
  techAuthor: colors.bright + colors.cyan,
};

function log(agent: string, message: string) {
  const color = agentColors[agent] || colors.reset;
  const icon = {
    architect: "🏛️ ",
    engineer: "⚙️ ",
    uxui: "🎨",
    researcher: "🔍",
    tester: "🧪",
    techAuthor: "📝",
  }[agent] || "🤖";

  console.log(`${color}${colors.bright}[${icon} ${agent.toUpperCase()}]${colors.reset}`);
  console.log(`${color}${message}${colors.reset}\n`);
}

async function askForApproval(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${colors.yellow}${colors.bright}⚠️  ${question} (y/n): ${colors.reset}`, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

async function runAgent(
  agentName: string,
  agent: AgentDefinition,
  task: string,
  context: string = ""
): Promise<string> {
  log(agentName, `Starting task...`);

  const systemPrompt = `${agent.prompt}

You are part of a multi-agent team working on FocusBoard.
Your current task is below. Be concise and actionable.

Available tools for your role: ${agent.tools.join(", ")}
(Note: In this orchestrator, you provide recommendations - the human executes)`;

  const userMessage = context
    ? `Previous context from other agents:\n${context}\n\n---\n\nYour task:\n${task}`
    : task;

  try {
    const response = await client.messages.create({
      model: agent.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const content = response.content[0];
    if (content.type === "text") {
      log(agentName, content.text);
      return content.text;
    }
    return "";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(agentName, `Error: ${errorMessage}`);
    return `Error: ${errorMessage}`;
  }
}

export async function runWorkflow(task: string, autoApprove: boolean = false) {
  console.log("\n" + "═".repeat(60));
  console.log(`${colors.bright}${colors.cyan}  FocusBoard Agent Orchestrator${colors.reset}`);
  console.log("═".repeat(60));
  console.log(`\n${colors.dim}Task: ${task}${colors.reset}\n`);

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`${colors.red}Error: ANTHROPIC_API_KEY environment variable not set.${colors.reset}`);
    console.log(`\nSet it with: export ANTHROPIC_API_KEY=your_key_here`);
    console.log(`Or run with: ANTHROPIC_API_KEY=your_key npx tsx orchestrator.ts "task"`);
    process.exit(1);
  }

  let context = "";

  // Step 1: Researcher (if task seems to need research)
  if (task.toLowerCase().includes("add") || task.toLowerCase().includes("implement") || task.toLowerCase().includes("new")) {
    console.log(`${colors.dim}─── Step 1: Research ───${colors.reset}\n`);
    const researchResult = await runAgent(
      "researcher",
      agents.researcher,
      `Research best practices and approaches for: ${task}`,
      ""
    );
    context += `\n## Researcher Findings:\n${researchResult}\n`;
  }

  // Step 2: Architect
  console.log(`${colors.dim}─── Step 2: Architecture Review ───${colors.reset}\n`);
  const architectResult = await runAgent(
    "architect",
    agents.architect,
    `Review and design approach for: ${task}\n\nProvide:\n1. Files that need modification\n2. Architectural considerations\n3. Potential risks or concerns`,
    context
  );
  context += `\n## Architect Analysis:\n${architectResult}\n`;

  // Step 3: UX/UI (if task involves UI)
  if (task.toLowerCase().includes("ui") || task.toLowerCase().includes("component") ||
      task.toLowerCase().includes("button") || task.toLowerCase().includes("modal") ||
      task.toLowerCase().includes("style") || task.toLowerCase().includes("design")) {
    console.log(`${colors.dim}─── Step 3: UX/UI Review ───${colors.reset}\n`);
    const uxResult = await runAgent(
      "uxui",
      agents.uxui,
      `Review UX/UI implications for: ${task}`,
      context
    );
    context += `\n## UX/UI Review:\n${uxResult}\n`;
  }

  // Checkpoint: Ask for approval before implementation
  console.log("─".repeat(60));
  let approved = autoApprove;
  if (!autoApprove) {
    approved = await askForApproval("Proceed with implementation recommendations?");
  } else {
    console.log(`${colors.green}Auto-approved: proceeding with implementation...${colors.reset}\n`);
  }

  if (!approved) {
    console.log(`\n${colors.yellow}Workflow paused. Review the above recommendations.${colors.reset}\n`);
    return;
  }

  // Step 4: Engineer recommendations
  console.log(`\n${colors.dim}─── Step 4: Implementation Plan ───${colors.reset}\n`);
  const engineerResult = await runAgent(
    "engineer",
    agents.engineer,
    `Based on the analysis above, provide specific implementation steps for: ${task}\n\nInclude:\n1. Exact code changes needed\n2. Files to modify\n3. Any new files to create`,
    context
  );
  context += `\n## Engineer Implementation Plan:\n${engineerResult}\n`;

  // Step 5: Tester recommendations
  console.log(`${colors.dim}─── Step 5: Testing Plan ───${colors.reset}\n`);
  const testerResult = await runAgent(
    "tester",
    agents.tester,
    `Create a testing plan for: ${task}\n\nInclude:\n1. Test cases to add\n2. Existing tests to update\n3. Manual testing steps`,
    context
  );
  context += `\n## Tester Plan:\n${testerResult}\n`;

  // Step 6: Technical Author (documentation updates)
  console.log(`${colors.dim}─── Step 6: Documentation ───${colors.reset}\n`);
  await runAgent(
    "techAuthor",
    agents.techAuthor,
    `Identify documentation updates needed for: ${task}\n\nReview the implementation plan above and specify:\n1. README.md changes (features, usage)\n2. ARCHITECTURE.md changes (new files, patterns)\n3. Any code comments needed`,
    context
  );

  console.log("═".repeat(60));
  console.log(`${colors.green}${colors.bright}  Workflow Complete${colors.reset}`);
  console.log("═".repeat(60));
  console.log(`\n${colors.dim}The agents have provided their recommendations.`);
  console.log(`Review the output above and implement as needed.${colors.reset}\n`);
}

// CLI entry point
const args = process.argv.slice(2);
const autoApprove = args.includes("--auto-approve") || args.includes("-y");
const task = args.filter(a => !a.startsWith("-")).join(" ");

if (!task) {
  console.log(`
${colors.bright}FocusBoard Agent Orchestrator${colors.reset}

Usage:
  ANTHROPIC_API_KEY=your_key npx tsx orchestrator.ts "<task description>"

Examples:
  npx tsx orchestrator.ts "Add dark mode toggle"
  npx tsx orchestrator.ts "Fix the webhook swimlane bug"
  npx tsx orchestrator.ts "Review authentication flow for security"

${colors.dim}Available Agents:${colors.reset}
${Object.entries(agents)
  .map(([name, def]) => `  ${agentColors[name] || ""}${name.padEnd(12)}${colors.reset} - ${def.description}`)
  .join("\n")}

${colors.dim}Environment:${colors.reset}
  ANTHROPIC_API_KEY - Required for API access
`);
  process.exit(0);
}

runWorkflow(task, autoApprove).catch(console.error);
