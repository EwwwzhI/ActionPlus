import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AppState,
  ArchiveSettings,
  DEFAULT_GROUP,
  DEFAULT_GROUP_ID,
  AutoRule,
  NotificationSettings,
  PlanType,
  ScoreArchive,
  Task,
  TaskGroup,
  TaskTemplate,
  initialState
} from "./state";

const STATE_KEY = "reward_plan_state_v1";

const PLAN_TYPES: PlanType[] = ["daily", "longterm"];
const AUTO_RULES: AutoRule[] = ["daily", "weekday", "monWedFri"];

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTask(raw: unknown, todayKey: string, groupIds: Set<string>): Task | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<Task> & { points?: number };
  const rawPlanType = (raw as { planType?: unknown }).planType;
  if (typeof data.id !== "string" || typeof data.title !== "string") return null;
  let planType =
    typeof rawPlanType === "string" && PLAN_TYPES.includes(rawPlanType as PlanType)
      ? (rawPlanType as PlanType)
      : "daily";
  if (rawPlanType === "weekly" || rawPlanType === "monthly") {
    planType = "longterm";
  }
  const createdAt = Number.isFinite(data.createdAt) ? Number(data.createdAt) : Date.now();
  const maxSource = Number.isFinite(data.maxPoints) ? Number(data.maxPoints) : Number(data.points ?? 0);
  const maxPoints = Math.max(0, Math.round(maxSource));
  const earnedRaw = Number.isFinite(data.earnedPoints) ? Number(data.earnedPoints) : null;
  const earnedPoints = earnedRaw === null ? null : Math.min(maxPoints, Math.max(0, Math.round(earnedRaw)));
  const settledAt = Number.isFinite(data.settledAt) ? Number(data.settledAt) : null;
  const note = typeof data.note === "string" ? data.note.trim() : undefined;
  const rawDetailNote = (raw as { detailNote?: unknown }).detailNote;
  const detailNote = typeof rawDetailNote === "string" ? rawDetailNote.trim() : undefined;
  const completed = Boolean(data.completed);
  const targetDate =
    planType === "daily" && typeof data.targetDate === "string" ? data.targetDate : planType === "daily" ? todayKey : undefined;
  const groupId =
    typeof data.groupId === "string" && groupIds.has(data.groupId) ? data.groupId : DEFAULT_GROUP_ID;
  const sourceTemplateId =
    typeof (raw as { sourceTemplateId?: unknown }).sourceTemplateId === "string"
      ? (raw as { sourceTemplateId?: string }).sourceTemplateId
      : undefined;
  return {
    id: data.id,
    title: data.title,
    groupId,
    planType,
    sourceTemplateId,
    maxPoints,
    earnedPoints,
    settledAt,
    note: note || undefined,
    detailNote: detailNote || undefined,
    completed,
    targetDate,
    createdAt
  };
}

function normalizeTemplate(raw: unknown): TaskTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<TaskTemplate>;
  if (typeof data.id !== "string" || typeof data.title !== "string") return null;
  const planType = PLAN_TYPES.includes(data.planType as PlanType) ? (data.planType as PlanType) : "daily";
  const createdAt = Number.isFinite(data.createdAt) ? Number(data.createdAt) : Date.now();
  const maxSource = Number.isFinite(data.maxPoints) ? Number(data.maxPoints) : 0;
  const maxPoints = Math.max(0, Math.round(maxSource));
  const autoRule = AUTO_RULES.includes(data.autoRule as AutoRule) ? (data.autoRule as AutoRule) : "daily";
  return {
    id: data.id,
    title: data.title,
    groupId: typeof data.groupId === "string" ? data.groupId : DEFAULT_GROUP_ID,
    planType,
    maxPoints,
    autoDaily: Boolean(data.autoDaily),
    autoRule,
    createdAt
  };
}

function normalizeGroup(raw: unknown): TaskGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<TaskGroup>;
  if (typeof data.id !== "string" || typeof data.name !== "string") return null;
  const createdAt = Number.isFinite(data.createdAt) ? Number(data.createdAt) : Date.now();
  const name = data.name.trim();
  if (!name) return null;
  const color = typeof data.color === "string" && data.color.trim() ? data.color.trim() : DEFAULT_GROUP.color;
  return { id: data.id, name, color, createdAt };
}

function normalizeArchive(raw: unknown): ScoreArchive | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<ScoreArchive>;
  if (typeof data.id !== "string" || typeof data.endDate !== "string") return null;
  const totalPoints = Number.isFinite(data.totalPoints) ? Number(data.totalPoints) : 0;
  const createdAt = Number.isFinite(data.createdAt) ? Number(data.createdAt) : Date.now();
  return {
    id: data.id,
    totalPoints,
    endDate: data.endDate,
    createdAt
  };
}

function normalizeArchiveSettings(raw: unknown): ArchiveSettings {
  if (!raw || typeof raw !== "object") {
    return initialState.archiveSettings;
  }
  const data = raw as Partial<ArchiveSettings>;
  const cycleDays = Number.isFinite(data.cycleDays) ? Math.max(1, Math.round(Number(data.cycleDays))) : 30;
  const periodStart = typeof data.periodStart === "string" ? data.periodStart : null;
  return { cycleDays, periodStart };
}

function normalizeNotificationSettings(raw: unknown, tasks: Task[]): NotificationSettings {
  if (!raw || typeof raw !== "object") {
    return initialState.notificationSettings;
  }
  const data = raw as Partial<NotificationSettings>;
  const enabled = typeof data.enabled === "boolean" ? data.enabled : true;
  const hour = Number.isFinite(data.hour) ? Math.min(23, Math.max(0, Math.round(Number(data.hour)))) : 8;
  const minute = Number.isFinite(data.minute)
    ? Math.min(59, Math.max(0, Math.round(Number(data.minute))))
    : 0;
  const taskIdsRaw = Array.isArray(data.taskIds) ? data.taskIds : [];
  const validTaskIdSet = new Set(tasks.map((task) => task.id));
  const taskIds = Array.from(
    new Set(
      taskIdsRaw.filter((id): id is string => typeof id === "string" && validTaskIdSet.has(id))
    )
  );
  return { enabled, hour, minute, taskIds };
}

export async function loadState(): Promise<AppState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return initialState;
    const data = JSON.parse(raw) as Partial<AppState>;
    const todayKey = formatLocalDate(new Date());
    const groups = Array.isArray((data as { groups?: unknown[] }).groups)
      ? (data as { groups?: unknown[] }).groups
          ?.map((item) => normalizeGroup(item))
          .filter((item): item is TaskGroup => Boolean(item)) ?? []
      : [];
    const finalGroups = groups.length > 0 ? groups : [DEFAULT_GROUP];
    const groupIds = new Set(finalGroups.map((group) => group.id));
    const tasks = Array.isArray(data.tasks)
      ? data.tasks
          .map((item) => normalizeTask(item, todayKey, groupIds))
          .filter((item): item is Task => Boolean(item))
      : [];
    const templates = Array.isArray((data as { templates?: unknown[] }).templates)
      ? (data as { templates?: unknown[] }).templates
          ?.map((item) => normalizeTemplate(item))
          .filter((item): item is TaskTemplate => Boolean(item)) ?? []
      : [];
    const archives = Array.isArray((data as { archives?: unknown[] }).archives)
      ? (data as { archives?: unknown[] }).archives
          ?.map((item) => normalizeArchive(item))
          .filter((item): item is ScoreArchive => Boolean(item)) ?? []
      : [];
    const normalizedTemplates = templates.map((template) =>
      groupIds.has(template.groupId) ? template : { ...template, groupId: DEFAULT_GROUP_ID }
    );
    return {
      points: Number.isFinite(data.points) ? Number(data.points) : initialState.points,
      tasks,
      templates: normalizedTemplates,
      groups: finalGroups,
      archives,
      archiveSettings: normalizeArchiveSettings((data as { archiveSettings?: unknown }).archiveSettings),
      notificationSettings: normalizeNotificationSettings(
        (data as { notificationSettings?: unknown }).notificationSettings,
        tasks
      )
    };
  } catch (error) {
    return initialState;
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    const payload = JSON.stringify(state);
    await AsyncStorage.setItem(STATE_KEY, payload);
  } catch (error) {
    // Ignore persistence errors to keep the UI responsive.
  }
}
