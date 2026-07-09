import type { FilterGroup, FilterRule } from './types.js';

export type ParticipantFields = Record<string, unknown> & {
  name?: string;
  age?: number;
  gender?: string | null;
  rating?: number | null;
  club?: string | null;
  customFields?: Record<string, unknown>;
};

function resolveField(participant: ParticipantFields, field: string): unknown {
  if (field in participant && field !== 'customFields') {
    return participant[field];
  }
  return participant.customFields?.[field];
}

function matchRule(participant: ParticipantFields, rule: FilterRule): boolean {
  const left = resolveField(participant, rule.field);
  const right = rule.value;

  switch (rule.op) {
    case 'eq':
      return normalize(left) === normalize(right);
    case 'neq':
      return normalize(left) !== normalize(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'in':
      return Array.isArray(right) && right.map(normalize).includes(normalize(left));
    default:
      return false;
  }
}

function normalize(value: unknown): string | number | boolean {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

export function matchesFilter(
  participant: ParticipantFields,
  filter: FilterGroup,
): boolean {
  if (!filter.rules.length) return true;
  if (filter.logic === 'or') {
    return filter.rules.some((rule) => matchRule(participant, rule));
  }
  return filter.rules.every((rule) => matchRule(participant, rule));
}

export function assignCategories<T extends { id: string }>(
  participants: ParticipantFields[],
  categories: Array<T & { filter: FilterGroup }>,
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  participants.forEach((p, index) => {
    const ids = categories
      .filter((c) => matchesFilter(p, c.filter))
      .map((c) => c.id);
    result.set(index, ids);
  });
  return result;
}

/** Preset helpers for common youth categories */
export const PRESET_FILTERS = {
  under12: {
    logic: 'and' as const,
    rules: [{ field: 'age', op: 'lt' as const, value: 12 }],
  },
  under18: {
    logic: 'and' as const,
    rules: [
      { field: 'age', op: 'gte' as const, value: 12 },
      { field: 'age', op: 'lt' as const, value: 18 },
    ],
  },
  female: {
    logic: 'and' as const,
    rules: [{ field: 'gender', op: 'eq' as const, value: 'F' }],
  },
  male: {
    logic: 'and' as const,
    rules: [{ field: 'gender', op: 'eq' as const, value: 'M' }],
  },
};
