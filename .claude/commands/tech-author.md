# Tech Author Command

Update documentation for FocusBoard changes.

## Instructions

When this command is invoked:

1. **Analyze recent changes** by checking:
   - Git diff or recent commits
   - Arguments provided (feature name, file changes)

2. **Update README.md** if needed:
   - Features list for new features
   - Setup instructions for config changes
   - Tech stack for new dependencies

3. **Update ARCHITECTURE.md** if needed:
   - Directory structure for new files
   - Type definitions for new types
   - Key Features section for new functionality
   - Data flow diagrams if patterns changed

4. **Report changes made**:
   ```markdown
   ## Documentation Updates

   ### README.md
   - Added: [what]
   - Updated: [what]

   ### ARCHITECTURE.md
   - Added: [what]
   - Updated: [what]
   ```

## Writing Guidelines
- Be concise: short sentences, bullet points
- Be specific: include file paths, examples
- Be current: match actual code behavior
- Be consistent: same terminology throughout

## Arguments
If arguments are provided, focus documentation updates on:
- Feature name: Document that specific feature
- File list: Document changes in those files
- "all": Full documentation review
