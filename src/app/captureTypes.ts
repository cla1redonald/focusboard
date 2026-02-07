// Capture Hub types — shared between client and referenced by API endpoints

export type CaptureSource = 'email' | 'slack' | 'shortcut' | 'browser' | 'whatsapp' | 'in_app';

export type CaptureStatus = 'pending' | 'processing' | 'ready' | 'auto_added' | 'dismissed';

export type ParsedCaptureCard = {
  title: string;
  notes?: string;
  tags?: string[];        // Tag IDs from existing board tags
  swimlane?: 'work' | 'personal';
  suggestedColumn?: string; // Column ID
  dueDate?: string;        // ISO date
  confidence: number;      // 0.0 - 1.0
  duplicateOf?: string;    // Card ID if duplicate detected
  relatedTo?: string[];    // Card IDs for relationship suggestions
};

export type CaptureQueueItem = {
  id: string;
  user_id: string;
  status: CaptureStatus;
  confidence: number | null;
  source: CaptureSource;
  raw_content: string;
  raw_metadata: Record<string, unknown>;
  parsed_cards: ParsedCaptureCard[] | null;
  created_at: string;
  processed_at: string | null;
};

// Source display config for the UI
export const SOURCE_CONFIG: Record<CaptureSource, { label: string; borderColor: string; darkBorderColor: string; icon: string }> = {
  slack:    { label: 'Slack',    borderColor: 'border-l-emerald-500', darkBorderColor: 'dark:border-l-emerald-400', icon: '💬' },
  email:    { label: 'Email',    borderColor: 'border-l-blue-500',    darkBorderColor: 'dark:border-l-blue-400',    icon: '📧' },
  browser:  { label: 'Browser',  borderColor: 'border-l-teal-500',    darkBorderColor: 'dark:border-l-teal-400',    icon: '🌐' },
  shortcut: { label: 'Shortcut', borderColor: 'border-l-amber-500',   darkBorderColor: 'dark:border-l-amber-400',   icon: '⚡' },
  whatsapp: { label: 'WhatsApp', borderColor: 'border-l-green-500',   darkBorderColor: 'dark:border-l-green-400',   icon: '📱' },
  in_app:   { label: 'In-App',   borderColor: 'border-l-gray-400',    darkBorderColor: 'dark:border-l-gray-500',    icon: '📋' },
};
