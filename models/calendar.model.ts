export type CalendarDateStrategy = "start" | "end" | "created" | "lastModified";
export type CalendarSortOrder = "startAsc" | "startDesc" | "modifiedDesc";
export type CalendarLinkStrategy = "eventUrl" | "location" | "calendarUrl" | "none";

export type CalendarFilterRule = {
  field: "summary" | "location" | "description" | "categories";
  type: "keyword" | "regex";
  value: string;
  caseSensitive?: boolean;
};

export type CalendarFeedConfig = {
  url: string;
  windowDays: number;
  includePastEvents: boolean;
  expandRecurringEvents: boolean;
  maxEvents: number;
  sortOrder: CalendarSortOrder;
  dateStrategy: CalendarDateStrategy;
  linkStrategy: CalendarLinkStrategy;
  timezoneFallback?: string;
  includeCanceled: boolean;
  filters?: { include?: CalendarFilterRule[]; exclude?: CalendarFilterRule[] };
};

export type CalendarEventItem = {
  uid: string;
  recurrenceId?: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizer?: string;
  categories: string[];
  status?: string;
  start?: Date;
  end?: Date;
  created?: Date;
  lastModified?: Date;
  sequence?: number;
};

export type CalendarParseOptions = {
  windowDays: number;
  includePastEvents: boolean;
  expandRecurringEvents: boolean;
  maxEvents: number;
  sortOrder: CalendarSortOrder;
  includeCanceled: boolean;
  timezoneFallback?: string;
  filters?: CalendarFeedConfig["filters"];
};

export type CalendarParseResult = {
  events: CalendarEventItem[];
  warnings: string[];
  stats: {
    totalEvents: number;
    filteredEvents: number;
    recurringExpanded: number;
    canceledExcluded: number;
    timezoneWarnings: number;
  };
};
