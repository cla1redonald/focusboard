#!/usr/bin/env tsx
/**
 * Code Review Workflow
 *
 * Comprehensive review using multiple perspectives:
 * 1. Architect → reviews structure and patterns
 * 2. UX/UI → reviews interface and accessibility
 * 3. Tester → checks test coverage
 * 4. Researcher → (optional) suggests improvements
 *
 * Usage:
 *   npx tsx workflows/review.ts "Review the TimelinePanel component"
 */

import { runWorkflow } from "../orchestrator.js";

export function createReviewPrompt(targetDescription: string): string {
  return `
## Code Review: ${targetDescription}

Execute this comprehensive review:

### Step 1: Architectural Review (Architect Agent)
- Review code structure and patterns
- Check for potential scalability issues
- Identify any security concerns
- Assess state management approach
- Look for unnecessary complexity
- Rate: Architecture quality (1-10) with reasoning

### Step 2: UX/UI Review (UX/UI Agent)
- Review component styling consistency
- Check accessibility (ARIA labels, keyboard nav)
- Verify responsive design
- Check for design system compliance
- Rate: UX quality (1-10) with reasoning

### Step 3: Test Coverage Review (Tester Agent)
- Check existing test coverage for this code
- Identify missing test cases
- Run tests and report results
- Rate: Test quality (1-10) with reasoning

### Step 4: Improvement Suggestions (Researcher Agent)
- Research how similar features are implemented elsewhere
- Suggest potential improvements
- Identify any outdated patterns
- Recommend refactoring opportunities

---

## Summary Format

After all reviews, provide:

| Aspect | Rating | Key Finding |
|--------|--------|-------------|
| Architecture | X/10 | ... |
| UX/UI | X/10 | ... |
| Testing | X/10 | ... |

### Top 3 Action Items
1. [Most important improvement]
2. [Second priority]
3. [Nice to have]
`;
}

// CLI entry point
const target = process.argv.slice(2).join(" ");

if (!target) {
  console.log(`
Code Review Workflow

Usage:
  npx tsx workflows/review.ts "<what to review>"

Examples:
  npx tsx workflows/review.ts "Review the TimelinePanel component"
  npx tsx workflows/review.ts "Review authentication flow"
  npx tsx workflows/review.ts "Review state management in state.ts"

This workflow provides:
  1. Architect  → Structure & patterns review
  2. UX/UI      → Design & accessibility review
  3. Tester     → Test coverage review
  4. Researcher → Improvement suggestions

Output includes ratings and prioritized action items.
`);
  process.exit(0);
}

runWorkflow(createReviewPrompt(target)).catch(console.error);
