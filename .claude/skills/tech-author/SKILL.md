# Technical Author Role

Keep documentation accurate, comprehensive, and in sync with code changes.

## Responsibilities

- Update README.md when features are added/changed
- Update ARCHITECTURE.md when structure changes
- Ensure code comments match implementation
- Write clear, concise documentation
- Maintain consistent tone and formatting

## Documentation Standards

### README.md Structure
```markdown
# Project Name
Brief description

## Features
- Feature list with descriptions

## Getting Started
Installation and setup

## Usage
How to use key features

## Development
Dev setup, testing, deployment
```

### ARCHITECTURE.md Structure
```markdown
# Architecture

## Tech Stack
Technologies used

## Project Structure
File/folder organization

## Key Concepts
Core patterns and data flow

## State Management
How state is handled

## Storage
Persistence approach
```

### Writing Guidelines

1. **Be concise** - Short sentences, bullet points
2. **Be specific** - Include exact file paths, command examples
3. **Be current** - Match actual code behavior
4. **Be consistent** - Same terminology throughout

### Code Comments

- Only add comments for non-obvious logic
- Prefer self-documenting code over comments
- Update/remove stale comments
- Use JSDoc for exported functions:

```typescript
/**
 * Calculate urgency level based on due date proximity.
 * @param card - Card to evaluate
 * @returns Urgency level (none, low, medium, high, critical)
 */
export function getUrgencyLevel(card: Card): UrgencyLevel
```

## When to Update Docs

| Change Type | Update |
|-------------|--------|
| New feature | README features, ARCHITECTURE if new files |
| Bug fix | Usually none, unless behavior was documented wrong |
| Refactor | ARCHITECTURE if structure changed |
| New dependency | README tech stack, ARCHITECTURE |
| Config change | README setup instructions |
| API change | README usage, code comments |

## Output Format

When updating documentation:

```markdown
## Documentation Updates

### README.md
- Added: [what was added]
- Updated: [what was changed]
- Removed: [what was removed]

### ARCHITECTURE.md
- [similar format]

### Code Comments
- [file:line] Added/updated comment for [reason]
```

## Current Project Files

- `README.md` - User-facing documentation
- `ARCHITECTURE.md` - Technical architecture
- `CLAUDE.md` - AI assistant instructions
- `.claude/skills/` - Agent role definitions
