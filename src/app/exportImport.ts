import type { AppState, Card, Column, CardTemplate, Settings, Tag, TagCategory } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS } from "./constants";

export type ExportFormat = "json" | "csv";

export type ExportData = {
  version: 2;
  exportedAt: string;
  data: AppState;
};

export type ImportValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: AppState;
  stats?: {
    cardCount: number;
    columnCount: number;
    templateCount: number;
  };
};

export type ImportMode = "replace" | "merge";

// Export functions
export function exportToJson(state: AppState): string {
  const exportData: ExportData = {
    version: 2,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  return JSON.stringify(exportData, null, 2);
}

export function exportToCsv(cards: Card[], columns: Column[]): string {
  const columnMap = new Map(columns.map((c) => [c.id, c.title]));

  const headers = [
    "id",
    "title",
    "column",
    "columnName",
    "icon",
    "notes",
    "link",
    "dueDate",
    "tags",
    "checklistItems",
    "checklistCompleted",
    "createdAt",
    "updatedAt",
    "completedAt",
    "blockedReason",
  ];

  const escapeCell = (value: string | undefined | null): string => {
    if (value === undefined || value === null) return "";
    const str = String(value);
    // Escape quotes and wrap in quotes if contains comma, newline, or quote
    if (str.includes(",") || str.includes("\n") || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = cards.map((card) => {
    const checklistTotal = card.checklist?.length ?? 0;
    const checklistDone = card.checklist?.filter((c) => c.done).length ?? 0;

    return [
      escapeCell(card.id),
      escapeCell(card.title),
      escapeCell(card.column),
      escapeCell(columnMap.get(card.column) ?? card.column),
      escapeCell(card.icon),
      escapeCell(card.notes),
      escapeCell(card.link),
      escapeCell(card.dueDate),
      escapeCell(card.tags?.join("; ")),
      escapeCell(String(checklistTotal)),
      escapeCell(String(checklistDone)),
      escapeCell(card.createdAt),
      escapeCell(card.updatedAt),
      escapeCell(card.completedAt),
      escapeCell(card.blockedReason),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Import functions
export function validateImportData(jsonString: string): ImportValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      valid: false,
      errors: ["Invalid JSON format. Please check the file contents."],
      warnings: [],
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      valid: false,
      errors: ["Import data must be an object."],
      warnings: [],
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Check if it's a v2 export format
  if (obj.version === 2 && obj.data) {
    return validateAppState(obj.data as Record<string, unknown>);
  }

  // Try to parse as raw AppState
  return validateAppState(obj);
}

function validateAppState(obj: Record<string, unknown>): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate cards
  let cards: Card[] = [];
  if (obj.cards !== undefined) {
    if (!Array.isArray(obj.cards)) {
      errors.push("'cards' must be an array.");
    } else {
      const cardValidation = validateCards(obj.cards);
      cards = cardValidation.cards;
      errors.push(...cardValidation.errors);
      warnings.push(...cardValidation.warnings);
    }
  }

  // Validate columns
  let columns: Column[] = DEFAULT_COLUMNS;
  if (obj.columns !== undefined) {
    if (!Array.isArray(obj.columns)) {
      errors.push("'columns' must be an array.");
    } else {
      const columnValidation = validateColumns(obj.columns);
      columns = columnValidation.columns;
      errors.push(...columnValidation.errors);
      warnings.push(...columnValidation.warnings);
    }
  } else {
    warnings.push("No columns found in import. Using default columns.");
  }

  // Validate templates
  let templates: CardTemplate[] = [];
  if (obj.templates !== undefined) {
    if (!Array.isArray(obj.templates)) {
      errors.push("'templates' must be an array.");
    } else {
      const templateValidation = validateTemplates(obj.templates);
      templates = templateValidation.templates;
      errors.push(...templateValidation.errors);
      warnings.push(...templateValidation.warnings);
    }
  }

  // Validate settings
  let settings: Settings = DEFAULT_SETTINGS;
  if (obj.settings !== undefined) {
    if (typeof obj.settings !== "object" || obj.settings === null) {
      errors.push("'settings' must be an object.");
    } else {
      settings = validateSettings(obj.settings as Record<string, unknown>);
    }
  } else {
    warnings.push("No settings found in import. Using default settings.");
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // Check for orphaned cards (cards in non-existent columns)
  const columnIds = new Set(columns.map((c) => c.id));
  const orphanedCards = cards.filter((c) => !columnIds.has(c.column));
  if (orphanedCards.length > 0) {
    warnings.push(
      `${orphanedCards.length} card(s) reference non-existent columns. They will be moved to the first column.`
    );
    const firstColumnId = columns[0]?.id ?? "backlog";
    cards = cards.map((c) =>
      columnIds.has(c.column) ? c : { ...c, column: firstColumnId }
    );
  }

  // Validate tagCategories
  let tagCategories: TagCategory[] = DEFAULT_TAG_CATEGORIES;
  if (obj.tagCategories !== undefined) {
    if (!Array.isArray(obj.tagCategories)) {
      warnings.push("'tagCategories' must be an array. Using defaults.");
    } else {
      tagCategories = validateTagCategories(obj.tagCategories);
    }
  }

  // Validate tags
  let tags: Tag[] = DEFAULT_TAGS;
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      warnings.push("'tags' must be an array. Using defaults.");
    } else {
      tags = validateTags(obj.tags);
    }
  }

  return {
    valid: true,
    errors: [],
    warnings,
    data: { cards, columns, templates, settings, tagCategories, tags },
    stats: {
      cardCount: cards.length,
      columnCount: columns.length,
      templateCount: templates.length,
    },
  };
}

function validateCards(arr: unknown[]): { cards: Card[]; errors: string[]; warnings: string[] } {
  const cards: Card[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== "object" || item === null) {
      errors.push(`Card at index ${i} is not an object.`);
      continue;
    }

    const card = item as Record<string, unknown>;

    // Required fields
    if (typeof card.id !== "string" || !card.id) {
      errors.push(`Card at index ${i} is missing a valid 'id'.`);
      continue;
    }

    if (seenIds.has(card.id)) {
      warnings.push(`Duplicate card ID '${card.id}' found. Skipping duplicate.`);
      continue;
    }
    seenIds.add(card.id);

    if (typeof card.title !== "string" || !card.title) {
      errors.push(`Card '${card.id}' is missing a valid 'title'.`);
      continue;
    }

    if (typeof card.column !== "string" || !card.column) {
      errors.push(`Card '${card.id}' is missing a valid 'column'.`);
      continue;
    }

    if (typeof card.createdAt !== "string") {
      errors.push(`Card '${card.id}' is missing a valid 'createdAt'.`);
      continue;
    }

    if (typeof card.updatedAt !== "string") {
      errors.push(`Card '${card.id}' is missing a valid 'updatedAt'.`);
      continue;
    }

    // Build validated card
    const validCard: Card = {
      id: card.id,
      title: card.title,
      column: card.column,
      order: typeof card.order === "number" ? card.order : i,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };

    // Optional fields
    if (typeof card.icon === "string") validCard.icon = card.icon;
    if (typeof card.notes === "string") validCard.notes = card.notes;
    if (typeof card.link === "string") validCard.link = card.link;
    if (typeof card.dueDate === "string") validCard.dueDate = card.dueDate;
    if (typeof card.completedAt === "string") validCard.completedAt = card.completedAt;
    if (typeof card.blockedReason === "string") validCard.blockedReason = card.blockedReason;
    if (typeof card.lastOverrideReason === "string") validCard.lastOverrideReason = card.lastOverrideReason;
    if (typeof card.lastOverrideAt === "string") validCard.lastOverrideAt = card.lastOverrideAt;

    if (Array.isArray(card.tags)) {
      validCard.tags = card.tags.filter((t): t is string => typeof t === "string");
    }

    if (Array.isArray(card.checklist)) {
      validCard.checklist = card.checklist
        .filter(
          (item): item is { id: string; text: string; done: boolean } =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as Record<string, unknown>).id === "string" &&
            typeof (item as Record<string, unknown>).text === "string" &&
            typeof (item as Record<string, unknown>).done === "boolean"
        )
        .map((item) => ({ id: item.id, text: item.text, done: item.done }));
    }

    if (Array.isArray(card.columnHistory)) {
      validCard.columnHistory = card.columnHistory.filter(
        (item): item is { from: string | null; to: string; at: string } =>
          typeof item === "object" &&
          item !== null &&
          (typeof (item as Record<string, unknown>).from === "string" ||
            (item as Record<string, unknown>).from === null) &&
          typeof (item as Record<string, unknown>).to === "string" &&
          typeof (item as Record<string, unknown>).at === "string"
      );
    }

    if (Array.isArray(card.relations)) {
      validCard.relations = card.relations.filter(
        (item): item is { id: string; type: string; targetCardId: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === "string" &&
          typeof (item as Record<string, unknown>).type === "string" &&
          typeof (item as Record<string, unknown>).targetCardId === "string"
      ) as Card["relations"];
    }

    cards.push(validCard);
  }

  return { cards, errors, warnings };
}

function validateColumns(arr: unknown[]): { columns: Column[]; errors: string[]; warnings: string[] } {
  const columns: Column[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== "object" || item === null) {
      errors.push(`Column at index ${i} is not an object.`);
      continue;
    }

    const col = item as Record<string, unknown>;

    if (typeof col.id !== "string" || !col.id) {
      errors.push(`Column at index ${i} is missing a valid 'id'.`);
      continue;
    }

    if (seenIds.has(col.id)) {
      warnings.push(`Duplicate column ID '${col.id}' found. Skipping duplicate.`);
      continue;
    }
    seenIds.add(col.id);

    if (typeof col.title !== "string" || !col.title) {
      errors.push(`Column '${col.id}' is missing a valid 'title'.`);
      continue;
    }

    columns.push({
      id: col.id,
      title: col.title,
      icon: typeof col.icon === "string" ? col.icon : "",
      color: typeof col.color === "string" ? col.color : "#10b981",
      wipLimit: typeof col.wipLimit === "number" ? col.wipLimit : null,
      isTerminal: typeof col.isTerminal === "boolean" ? col.isTerminal : false,
      order: typeof col.order === "number" ? col.order : i,
    });
  }

  if (columns.length === 0) {
    warnings.push("No valid columns found. Using default columns.");
    return { columns: DEFAULT_COLUMNS, errors, warnings };
  }

  return { columns, errors, warnings };
}

function validateTemplates(arr: unknown[]): { templates: CardTemplate[]; errors: string[]; warnings: string[] } {
  const templates: CardTemplate[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== "object" || item === null) {
      warnings.push(`Template at index ${i} is not valid. Skipping.`);
      continue;
    }

    const tmpl = item as Record<string, unknown>;

    if (typeof tmpl.id !== "string" || !tmpl.id) {
      warnings.push(`Template at index ${i} is missing an id. Skipping.`);
      continue;
    }

    if (typeof tmpl.name !== "string" || !tmpl.name) {
      warnings.push(`Template '${tmpl.id}' is missing a name. Skipping.`);
      continue;
    }

    if (typeof tmpl.title !== "string" || !tmpl.title) {
      warnings.push(`Template '${tmpl.id}' is missing a title. Skipping.`);
      continue;
    }

    if (typeof tmpl.defaultColumn !== "string" || !tmpl.defaultColumn) {
      warnings.push(`Template '${tmpl.id}' is missing a defaultColumn. Skipping.`);
      continue;
    }

    const validTemplate: CardTemplate = {
      id: tmpl.id,
      name: tmpl.name,
      title: tmpl.title,
      defaultColumn: tmpl.defaultColumn,
    };

    if (typeof tmpl.icon === "string") validTemplate.icon = tmpl.icon;
    if (typeof tmpl.notes === "string") validTemplate.notes = tmpl.notes;
    if (Array.isArray(tmpl.tags)) {
      validTemplate.tags = tmpl.tags.filter((t): t is string => typeof t === "string");
    }
    if (Array.isArray(tmpl.checklist)) {
      validTemplate.checklist = tmpl.checklist.filter(
        (item): item is { text: string; done: boolean } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).text === "string" &&
          typeof (item as Record<string, unknown>).done === "boolean"
      );
    }

    templates.push(validTemplate);
  }

  return { templates, errors, warnings };
}

function validateSettings(obj: Record<string, unknown>): Settings {
  return {
    celebrations: typeof obj.celebrations === "boolean" ? obj.celebrations : DEFAULT_SETTINGS.celebrations,
    reducedMotionOverride:
      typeof obj.reducedMotionOverride === "boolean"
        ? obj.reducedMotionOverride
        : DEFAULT_SETTINGS.reducedMotionOverride,
    backgroundImage:
      typeof obj.backgroundImage === "string" ? obj.backgroundImage : DEFAULT_SETTINGS.backgroundImage,
    showAgingIndicators:
      typeof obj.showAgingIndicators === "boolean"
        ? obj.showAgingIndicators
        : DEFAULT_SETTINGS.showAgingIndicators,
    staleCardThreshold:
      obj.staleCardThreshold === 3 || obj.staleCardThreshold === 7 || obj.staleCardThreshold === 14
        ? obj.staleCardThreshold
        : DEFAULT_SETTINGS.staleCardThreshold,
    autoPriorityFromDueDate:
      typeof obj.autoPriorityFromDueDate === "boolean"
        ? obj.autoPriorityFromDueDate
        : DEFAULT_SETTINGS.autoPriorityFromDueDate,
    staleBacklogThreshold:
      obj.staleBacklogThreshold === 3 || obj.staleBacklogThreshold === 7 || obj.staleBacklogThreshold === 14
        ? obj.staleBacklogThreshold
        : DEFAULT_SETTINGS.staleBacklogThreshold,
    collapsedSwimlanes: Array.isArray(obj.collapsedSwimlanes)
      ? obj.collapsedSwimlanes.filter((s): s is "work" | "personal" => s === "work" || s === "personal")
      : DEFAULT_SETTINGS.collapsedSwimlanes,
    theme:
      obj.theme === "light" || obj.theme === "dark" || obj.theme === "system"
        ? obj.theme
        : DEFAULT_SETTINGS.theme,
  };
}

function validateTagCategories(arr: unknown[]): TagCategory[] {
  const categories: TagCategory[] = [];

  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const cat = item as Record<string, unknown>;

    if (typeof cat.id !== "string" || !cat.id) continue;
    if (typeof cat.name !== "string" || !cat.name) continue;

    categories.push({
      id: cat.id,
      name: cat.name,
      order: typeof cat.order === "number" ? cat.order : categories.length,
    });
  }

  return categories.length > 0 ? categories : DEFAULT_TAG_CATEGORIES;
}

function validateTags(arr: unknown[]): Tag[] {
  const tags: Tag[] = [];

  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const tag = item as Record<string, unknown>;

    if (typeof tag.id !== "string" || !tag.id) continue;
    if (typeof tag.name !== "string" || !tag.name) continue;
    if (typeof tag.color !== "string" || !tag.color) continue;
    if (typeof tag.categoryId !== "string" || !tag.categoryId) continue;

    tags.push({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      categoryId: tag.categoryId,
    });
  }

  return tags.length > 0 ? tags : DEFAULT_TAGS;
}

// Merge import with existing state
export function mergeImportData(existing: AppState, imported: AppState): AppState {
  const existingCardIds = new Set(existing.cards.map((c) => c.id));
  const existingColumnIds = new Set(existing.columns.map((c) => c.id));
  const existingTemplateIds = new Set(existing.templates.map((t) => t.id));
  const existingTagCategoryIds = new Set(existing.tagCategories.map((c) => c.id));
  const existingTagIds = new Set(existing.tags.map((t) => t.id));

  // Add new cards (skip duplicates)
  const newCards = imported.cards.filter((c) => !existingCardIds.has(c.id));

  // Add new columns (skip duplicates)
  const newColumns = imported.columns.filter((c) => !existingColumnIds.has(c.id));
  const maxColumnOrder = Math.max(...existing.columns.map((c) => c.order), -1);
  const reorderedNewColumns = newColumns.map((c, i) => ({ ...c, order: maxColumnOrder + 1 + i }));

  // Add new templates (skip duplicates)
  const newTemplates = imported.templates.filter((t) => !existingTemplateIds.has(t.id));

  // Add new tag categories (skip duplicates)
  const newCategories = imported.tagCategories.filter((c) => !existingTagCategoryIds.has(c.id));
  const maxCategoryOrder = Math.max(...existing.tagCategories.map((c) => c.order), -1);
  const reorderedNewCategories = newCategories.map((c, i) => ({ ...c, order: maxCategoryOrder + 1 + i }));

  // Add new tags (skip duplicates)
  const newTags = imported.tags.filter((t) => !existingTagIds.has(t.id));

  return {
    cards: [...existing.cards, ...newCards],
    columns: [...existing.columns, ...reorderedNewColumns],
    templates: [...existing.templates, ...newTemplates],
    settings: existing.settings, // Keep existing settings in merge mode
    tagCategories: [...existing.tagCategories, ...reorderedNewCategories],
    tags: [...existing.tags, ...newTags],
  };
}
