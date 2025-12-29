# Tester Command

Run quality assurance tasks for FocusBoard.

## Instructions

When this command is invoked:

1. **Run the test suite**:
   ```bash
   npm run test:run
   ```

2. **Check TypeScript types**:
   ```bash
   npm run typecheck
   ```

3. **Report results**:
   - Number of tests passed/failed
   - Any TypeScript errors
   - Coverage gaps if relevant

4. **If tests fail**:
   - Identify the failing tests
   - Analyze the failure cause
   - Suggest or implement fixes

## Test Stack
- Vitest + React Testing Library
- Test files: `*.test.ts` and `*.test.tsx`
- Run coverage: `npm run test:coverage`

## Arguments
If arguments are provided, use them to focus the testing:
- File path: Run tests for specific file
- Feature name: Run tests related to that feature
- "coverage": Run with coverage report
