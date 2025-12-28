# Focusboard API

Focusboard provides a webhook API for adding cards from external automation tools like Apple Shortcuts, Zapier, IFTTT, or custom scripts.

## Base URL

```
https://focusboard-claire-donalds-projects.vercel.app
```

## Authentication

All API endpoints require a shared secret for authentication. The secret is passed in the request body.

## Endpoints

### Add Card

Add a new card to the board.

**Endpoint:** `POST /api/webhook/add-card`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Card title (will be trimmed) |
| `secret` | string | Yes | Webhook secret for authentication |
| `column` | string | No | Target column ID (default: `"backlog"`) |
| `source` | string | No | Source label for the note (default: `"Webhook"`) |

**Default Columns:**

| ID | Title |
|----|-------|
| `backlog` | Backlog |
| `design` | Design & Planning |
| `todo` | To Do |
| `doing` | Doing |
| `blocked` | Blocked |
| `done` | Done |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Added \"Buy coffee\" to backlog",
  "cardId": "abc123xyz"
}
```

**Error Responses:**

| Status | Response | Cause |
|--------|----------|-------|
| 400 | `{"error": "Title is required"}` | Missing or empty title |
| 401 | `{"error": "Invalid secret"}` | Wrong or missing secret |
| 405 | `{"error": "Method not allowed"}` | Not a POST request |
| 500 | `{"error": "..."}` | Server configuration or database error |

---

## Example Requests

### cURL

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Buy more coffee",
    "secret": "your-webhook-secret",
    "source": "Terminal"
  }'
```

### Python

```python
import requests

response = requests.post(
    "https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card",
    json={
        "title": "Review quarterly report",
        "secret": "your-webhook-secret",
        "column": "todo",
        "source": "Python Script"
    }
)
print(response.json())
```

### JavaScript (Node.js)

```javascript
const response = await fetch(
  "https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Finish documentation",
      secret: "your-webhook-secret",
      source: "Node Script"
    })
  }
);
const data = await response.json();
console.log(data);
```

### Apple Shortcuts

1. Create a new Shortcut
2. Add action: **Get Contents of URL**
3. Configure:
   - **URL:** `https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card`
   - **Method:** POST
   - **Headers:** `Content-Type: application/json`
   - **Request Body:** JSON
   - Add fields (lowercase keys required):
     - `title`: Shortcut Input or text
     - `secret`: your webhook secret
     - `source`: "Shortcuts" (optional)

**Important:** JSON keys must be lowercase (`title`, `secret`, `source`), not capitalized.

### Zapier

1. Create a new Zap
2. Add action: **Webhooks by Zapier > POST**
3. Configure:
   - **URL:** `https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card`
   - **Payload Type:** json
   - **Data:**
     - `title`: (your trigger data)
     - `secret`: your-webhook-secret
     - `source`: "Zapier"

---

## Card Data Model

Cards created via webhook have the following structure:

```typescript
{
  id: string;           // Auto-generated unique ID (nanoid)
  column: string;       // Target column ID
  title: string;        // Card title
  order: 0;             // Placed at top of column
  createdAt: string;    // ISO timestamp
  updatedAt: string;    // ISO timestamp
  tags: [];             // Empty array
  checklist: [];        // Empty array
  notes?: string;       // "Added from {source}" if source provided
  columnHistory: [{     // Movement history
    from: null,
    to: column,
    at: timestamp
  }];
}
```

---

## Environment Variables

The webhook endpoint requires these Vercel environment variables:

| Variable | Description |
|----------|-------------|
| `WEBHOOK_SECRET` | Shared secret for authentication |
| `FOCUSBOARD_USER_ID` | Your Supabase user UUID |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) |

See [SUPABASE.md](./SUPABASE.md) for database setup.

---

## Extending the API

To add new endpoints, create files in the `api/` directory:

```
api/
└── webhook/
    └── add-card.ts    # POST /api/webhook/add-card
```

Each file exports a default handler function:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Handle request
}
```

**Important:** API route files must be self-contained. Do not import from `src/` directory as this breaks Vercel's serverless function bundling. Inline all types and utilities.

---

## Troubleshooting

### Cards not appearing in the app

1. Check that cloud sync is enabled (Supabase credentials configured)
2. Verify RLS policies are set up correctly
3. Refresh the app - cards sync on page load

### 404 NOT_FOUND errors

1. Ensure deployment protection is disabled or bypassed
2. Check that the API file exists in `api/webhook/add-card.ts`
3. Verify the URL path matches exactly

### 401 Invalid secret

1. Verify `WEBHOOK_SECRET` is set in Vercel environment variables
2. Ensure the secret in your request matches exactly (case-sensitive)
3. Use lowercase JSON keys in requests

### 500 Server errors

1. Check Vercel function logs: `vercel logs --prod`
2. Verify all required environment variables are set
3. Confirm Supabase connection is working
