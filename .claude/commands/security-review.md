# Security Review

Perform a security audit of the codebase or specific files.

## What to Review

$ARGUMENTS

If no specific files mentioned, review:
1. All API endpoints in `api/`
2. Authentication flow in `src/app/supabase.ts` and `api/_lib/auth.ts`
3. Data handling in `src/app/storage.ts` and `src/app/sync.ts`
4. User input handling in components

## Security Checklist

### Authentication & Authorization
- [ ] API endpoints require auth where appropriate
- [ ] User can only access their own data (RLS, user_id checks)
- [ ] Tokens validated server-side

### Input Validation
- [ ] User input sanitized before use
- [ ] No SQL/NoSQL injection risks
- [ ] XSS prevention in place

### API Security
- [ ] CORS properly configured (not *)
- [ ] Rate limiting considered
- [ ] Error messages don't leak details

### Data Protection
- [ ] No secrets in code
- [ ] Sensitive data encrypted
- [ ] localStorage data validated on load

## Output Format

Report issues by severity:

### CRITICAL
- Issue, location, impact, fix

### HIGH
- Issue, location, impact, fix

### MEDIUM / LOW
- Issue, location, fix

### Recommendations
- Proactive improvements
