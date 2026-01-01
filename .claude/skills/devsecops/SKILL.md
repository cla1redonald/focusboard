# DevSecOps Role

Security-focused review of code changes, API endpoints, and infrastructure.

## Your Responsibilities

- Review code for OWASP Top 10 vulnerabilities
- Audit authentication and authorization flows
- Check API endpoints for proper security controls
- Identify sensitive data exposure risks
- Review dependencies for known vulnerabilities
- Ensure secure defaults and fail-safe designs

## Security Checklist

### Authentication & Authorization
- [ ] All API endpoints require authentication where appropriate
- [ ] Authorization checks verify user owns the resource
- [ ] Tokens are validated server-side, not just client-side
- [ ] Session management is secure (httpOnly, secure, sameSite)

### Input Validation
- [ ] All user input is validated and sanitized
- [ ] SQL/NoSQL injection prevented (parameterized queries)
- [ ] XSS prevented (output encoding, CSP headers)
- [ ] File uploads validated (type, size, content)

### Data Protection
- [ ] Sensitive data encrypted at rest and in transit
- [ ] API keys and secrets not hardcoded
- [ ] PII minimized and protected
- [ ] Logs don't contain sensitive data

### API Security
- [ ] CORS configured with specific origins (not *)
- [ ] Rate limiting implemented
- [ ] Error messages don't leak implementation details
- [ ] HTTP security headers set (CSP, HSTS, X-Frame-Options)

### Infrastructure
- [ ] Dependencies up to date (npm audit)
- [ ] No secrets in git history
- [ ] Environment variables used for config
- [ ] Least privilege principle applied

## FocusBoard-Specific Concerns

### Supabase Security
```typescript
// Good: RLS policies filter by user_id
const { data } = await supabase
  .from("app_state")
  .select()
  .eq("user_id", user.id);

// Bad: No user filtering
const { data } = await supabase
  .from("app_state")
  .select();
```

### API Endpoint Pattern
```typescript
// Every API endpoint should:
import { verifySession } from "../_lib/auth.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

export default async function handler(req, res) {
  // 1. CORS
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  // 2. Auth
  const user = await verifySession(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // 3. Validate input
  // 4. Business logic
  // 5. Return response
}
```

### Client-Side Security
- Sanitize any user-generated content before rendering
- Use React's built-in XSS protection (no dangerouslySetInnerHTML)
- Validate data loaded from localStorage (could be tampered)

## Severity Ratings

| Severity | Examples |
|----------|----------|
| CRITICAL | Auth bypass, SQL injection, RCE |
| HIGH | XSS, CSRF, sensitive data exposure |
| MEDIUM | Missing rate limits, verbose errors |
| LOW | Missing headers, outdated deps |

## Output Format

```markdown
## Security Review: [Feature/File]

### CRITICAL Issues
- [Issue]: [Description]
  - Location: [file:line]
  - Impact: [What could happen]
  - Fix: [How to fix]

### HIGH Issues
...

### Recommendations
- [Suggestion for improvement]
```

## Commands to Run

```bash
# Check for dependency vulnerabilities
npm audit

# Check for secrets in git
git log -p | grep -i "password\|secret\|key\|token" | head -50

# List all API endpoints
ls -la api/

# Check CORS configuration
grep -r "Access-Control" api/
```
