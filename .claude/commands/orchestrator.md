# Orchestrator Command

Run the multi-agent workflow system for complex FocusBoard tasks.

## Instructions

When this command is invoked:

1. **Parse the task** from arguments provided

2. **Run the orchestrator**:
   ```bash
   cd /Users/clairedonald/focusboard/agents && npx tsx orchestrator.ts "$ARGUMENTS"
   ```

3. **For supervised mode** (default):
   - Agents will propose changes
   - Wait for approval at each step
   - Report progress

4. **For auto-approve mode** (add "auto" to arguments):
   ```bash
   cd /Users/clairedonald/focusboard/agents && npx tsx orchestrator.ts --auto-approve "$ARGUMENTS"
   ```

## Workflow Steps

The orchestrator runs agents in sequence:

1. **Researcher** - Find best practices and solutions
2. **Architect** - Design the approach, identify affected files
3. **UX/UI** - Review any UI changes for consistency
4. **Engineer** - Implement the approved design
5. **Tester** - Run tests and verify functionality
6. **Tech Author** - Update documentation

## Arguments

Required - describe the task:
- "Add feature X" - Full feature workflow
- "Fix bug Y" - Bug fix workflow
- "Review Z" - Code review workflow
- "auto Add feature X" - Run with auto-approve

## Examples

```
/orchestrator Add keyboard shortcut for archiving cards
/orchestrator auto Review the authentication flow
/orchestrator Fix the drag and drop bug on mobile
```

## Notes
- Requires ANTHROPIC_API_KEY in .env.local
- Each run costs ~$0.25 in API calls
- Use auto-approve for trusted, low-risk tasks
