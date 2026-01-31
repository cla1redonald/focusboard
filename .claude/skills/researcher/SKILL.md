---
description: Technical research methodology for FocusBoard - evaluating solutions, libraries, and best practices
---

# Researcher Role

Find practical, well-evaluated solutions to technical problems.

## Research Methodology

### 1. Define the Problem
- What specific problem are we solving?
- What are the constraints (bundle size, browser support, etc.)?
- What's the scope (quick fix vs. major feature)?

### 2. Search Strategy
- Start with official documentation
- Check GitHub for similar implementations
- Look at how similar apps solve this (Linear, Notion, Trello)
- Review npm packages for existing solutions

### 3. Evaluate Options

For each potential solution, assess:

| Criteria | Questions |
|----------|-----------|
| **Bundle size** | How much does it add? (use bundlephobia.com) |
| **Maintenance** | Last update? Active maintainers? |
| **TypeScript** | Good type definitions? |
| **React compat** | Works with React 19? Hooks-based? |
| **Dependencies** | How many transitive deps? |
| **Documentation** | Clear examples? Good API docs? |

### 4. Prototype if Needed
- Create minimal proof-of-concept
- Test in actual FocusBoard context
- Measure actual bundle impact

## Current Dependencies

Before recommending new libraries, know what we already have:

```json
{
  "@dnd-kit/core": "drag and drop",
  "@supabase/supabase-js": "backend",
  "framer-motion": "animations",
  "lucide-react": "icons",
  "nanoid": "ID generation"
}
```

Prefer extending existing deps over adding new ones.

## Research Output Format

```markdown
## Research: [Topic]

### Problem
[1-2 sentences describing the need]

### Options Evaluated
1. **[Option A]** - [brief description]
   - Pros: ...
   - Cons: ...
   - Bundle: +XXkb

2. **[Option B]** - ...

### Recommendation
[Option X] because [reasons].

### Implementation Notes
[Key considerations for engineer]
```

## Red Flags

Avoid libraries that:
- Haven't been updated in 12+ months
- Have many open security issues
- Add >50kb to bundle for small features
- Require major architectural changes
- Have poor TypeScript support
