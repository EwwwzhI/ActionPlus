export type PlanType = "daily" | "longterm";
export type AutoRule = "daily" | "weekday" | "weekend";

export type Task = {
  id: string;
  title: string;
  groupId: string;
  planType: PlanType;
  sourceTemplateId?: string;
  detailNote?: string;
  deadlineDate?: string;
  maxPoints: number;
  earnedPoints: number | null;
  settledAt?: number | null;
  note?: string;
  completed: boolean;
  targetDate?: string;
  createdAt: number;
};

export type TaskGroup = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
};

export type ArchiveSettings = {
  cycleDays: number;
  periodStart: string | null;
};

export type NotificationDateMode = "today" | "tomorrow";
export type NotificationRepeatRule = "once" | "daily" | "weekday";
export type NotificationMode = "global_rule" | "follow_task";
export type LongtermReminderIntervalRule = "none" | "weekly" | "every14Days" | "every30Days";

export type NotificationSettings = {
  enabled: boolean;
  periodicHour: number;
  periodicMinute: number;
  singleHour: number;
  singleMinute: number;
  taskIds: string[];
  mode: NotificationMode;
  dateMode: NotificationDateMode;
  repeatRule: NotificationRepeatRule;
};

export type LongtermNotificationSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
  taskIds: string[];
  deadlineOffsets: number[];
  intervalRule: LongtermReminderIntervalRule;
};

export type ScoreArchive = {
  id: string;
  totalPoints: number;
  endDate: string;
  createdAt: number;
};

export type TaskTemplate = {
  id: string;
  title: string;
  groupId: string;
  planType: PlanType;
  maxPoints: number;
  autoDaily?: boolean;
  autoRule?: AutoRule;
  createdAt: number;
};

export const DEFAULT_GROUP_ID = "group_default";

export const DEFAULT_GROUP: TaskGroup = {
  id: DEFAULT_GROUP_ID,
  name: "默认",
  color: "#0E7490",
  createdAt: 0
};

export type AppState = {
  points: number;
  tasks: Task[];
  templates: TaskTemplate[];
  groups: TaskGroup[];
  archives: ScoreArchive[];
  archiveSettings: ArchiveSettings;
  notificationSettings: NotificationSettings;
  longtermNotificationSettings: LongtermNotificationSettings;
};

export const initialState: AppState = {
  points: 0,
  tasks: [],
  templates: [],
  groups: [DEFAULT_GROUP],
  archives: [],
  archiveSettings: { cycleDays: 30, periodStart: null },
  notificationSettings: {
    enabled: true,
    periodicHour: 8,
    periodicMinute: 0,
    singleHour: 8,
    singleMinute: 0,
    taskIds: [],
    mode: "global_rule",
    dateMode: "tomorrow",
    repeatRule: "daily"
  },
  longtermNotificationSettings: {
    enabled: false,
    hour: 20,
    minute: 0,
    taskIds: [],
    deadlineOffsets: [7, 3, 1, 0],
    intervalRule: "weekly"
  }
};

export type Action =
  | { type: "LOAD_STATE"; state: AppState }
  | { type: "ADD_GROUP"; group: TaskGroup }
  | { type: "RENAME_GROUP"; groupId: string; name: string; color?: string }
  | { type: "DELETE_GROUP"; groupId: string }
  | { type: "SET_ARCHIVE_CYCLE"; cycleDays: number; periodStart: string }
  | {
    type: "SET_NOTIFICATION_SETTINGS";
    enabled: boolean;
    periodicHour: number;
    periodicMinute: number;
    singleHour: number;
    singleMinute: number;
    taskIds: string[];
    mode: NotificationMode;
    dateMode: NotificationDateMode;
    repeatRule: NotificationRepeatRule;
  }
  | {
    type: "SET_LONGTERM_NOTIFICATION_SETTINGS";
    enabled: boolean;
    hour: number;
    minute: number;
    taskIds: string[];
    deadlineOffsets: number[];
    intervalRule: LongtermReminderIntervalRule;
  }
  | { type: "AUTO_ARCHIVE"; cycleDays: number; nextStart: string; endDate: string }
  | { type: "ADD_TASK"; task: Task }
  | { type: "TOGGLE_TASK"; taskId: string }
  | { type: "SET_TASK_EARNED"; taskId: string; earnedPoints: number; note?: string }
  | { type: "SET_TASK_DEADLINE"; taskId: string; deadlineDate?: string }
  | { type: "ADD_TEMPLATE"; template: TaskTemplate }
  | { type: "TOGGLE_TEMPLATE_AUTO"; templateId: string; enabled: boolean }
  | { type: "SET_TEMPLATE_AUTO_RULE"; templateId: string; rule: AutoRule }
  | { type: "DELETE_TEMPLATE"; templateId: string }
  | { type: "LINK_TASK_TO_TEMPLATE"; taskId: string; templateId: string }
  | { type: "DELETE_TASK"; taskId: string }
  | { type: "CLEANUP_OLD_RECORDS"; cutoffDate: string };

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function clampPoints(value: number): number {
  if (value < 0) return 0;
  return Math.round(value);
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "LOAD_STATE":
      return action.state;
    case "ADD_GROUP": {
      const name = action.group.name.trim();
      if (!name) return state;
      const exists = state.groups.some((group) => group.name === name);
      if (exists) return state;
      const color = action.group.color?.trim() || DEFAULT_GROUP.color;
      return { ...state, groups: [...state.groups, { ...action.group, name, color }] };
    }
    case "RENAME_GROUP": {
      const name = action.name.trim();
      if (!name) return state;
      const exists = state.groups.some((group) => group.name === name && group.id !== action.groupId);
      if (exists) return state;
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId
            ? { ...group, name, color: action.color?.trim() || group.color }
            : group
        )
      };
    }
    case "DELETE_GROUP": {
      if (action.groupId === DEFAULT_GROUP_ID) return state;
      const remainingGroups = state.groups.filter((group) => group.id !== action.groupId);
      const tasks = state.tasks.map((task) =>
        task.groupId === action.groupId ? { ...task, groupId: DEFAULT_GROUP_ID } : task
      );
      const templates = state.templates.map((template) =>
        template.groupId === action.groupId ? { ...template, groupId: DEFAULT_GROUP_ID } : template
      );
      return {
        ...state,
        groups: remainingGroups.length > 0 ? remainingGroups : [DEFAULT_GROUP],
        tasks,
        templates
      };
    }
    case "SET_ARCHIVE_CYCLE": {
      const cycleDays = Math.max(1, Math.round(action.cycleDays));
      const periodStart = action.periodStart.trim();
      if (!periodStart) return state;
      return {
        ...state,
        archiveSettings: {
          cycleDays,
          periodStart
        }
      };
    }
    case "SET_NOTIFICATION_SETTINGS": {
      const enabled = Boolean(action.enabled);
      const periodicHour = Math.min(23, Math.max(0, Math.round(action.periodicHour)));
      const periodicMinute = Math.min(59, Math.max(0, Math.round(action.periodicMinute)));
      const singleHour = Math.min(23, Math.max(0, Math.round(action.singleHour)));
      const singleMinute = Math.min(59, Math.max(0, Math.round(action.singleMinute)));
      const taskIds = Array.from(new Set(action.taskIds.filter((id) => typeof id === "string" && id)));
      const mode: NotificationMode = action.mode === "follow_task" ? "follow_task" : "global_rule";
      const dateMode = action.dateMode === "today" ? "today" : "tomorrow";
      const repeatRule =
        action.repeatRule === "once" || action.repeatRule === "weekday" ? action.repeatRule : "daily";
      return {
        ...state,
        notificationSettings: {
          enabled,
          periodicHour,
          periodicMinute,
          singleHour,
          singleMinute,
          taskIds,
          mode,
          dateMode,
          repeatRule
        }
      };
    }
    case "SET_LONGTERM_NOTIFICATION_SETTINGS": {
      const enabled = Boolean(action.enabled);
      const hour = Math.min(23, Math.max(0, Math.round(action.hour)));
      const minute = Math.min(59, Math.max(0, Math.round(action.minute)));
      const taskIds = Array.from(new Set(action.taskIds.filter((id) => typeof id === "string" && id)));
      const allowedOffsets = new Set([0, 1, 3, 7]);
      const deadlineOffsets = Array.from(
        new Set(
          action.deadlineOffsets
            .map((offset) => Math.max(0, Math.round(offset)))
            .filter((offset) => allowedOffsets.has(offset))
        )
      ).sort((a, b) => b - a);
      const intervalRule: LongtermReminderIntervalRule =
        action.intervalRule === "weekly" ||
          action.intervalRule === "every14Days" ||
          action.intervalRule === "every30Days"
          ? action.intervalRule
          : "none";
      return {
        ...state,
        longtermNotificationSettings: {
          enabled,
          hour,
          minute,
          taskIds,
          deadlineOffsets,
          intervalRule
        }
      };
    }
    case "AUTO_ARCHIVE": {
      const cycleDays = Math.max(1, Math.round(action.cycleDays));
      const endDate = action.endDate.trim();
      const nextStart = action.nextStart.trim();
      if (!nextStart) return state;
      if (state.points <= 0 || !endDate) {
        return {
          ...state,
          archiveSettings: {
            cycleDays,
            periodStart: nextStart
          }
        };
      }
      const archive: ScoreArchive = {
        id: makeId("arch"),
        totalPoints: state.points,
        endDate,
        createdAt: Date.now()
      };
      return {
        ...state,
        points: 0,
        archives: [archive, ...state.archives],
        archiveSettings: {
          cycleDays,
          periodStart: nextStart
        }
      };
    }
    case "ADD_TASK":
      return { ...state, tasks: [action.task, ...state.tasks] };
    case "TOGGLE_TASK": {
      const tasks = state.tasks.map((task) => {
        if (task.id !== action.taskId) return task;
        if (task.planType === "daily") return task;
        const nextCompleted = !task.completed;
        return { ...task, completed: nextCompleted };
      });
      return {
        ...state,
        tasks
      };
    }
    case "SET_TASK_EARNED": {
      let delta = 0;
      const tasks = state.tasks.map((task) => {
        if (task.id !== action.taskId) return task;
        const maxPoints = Math.max(0, task.maxPoints);
        const nextEarned = Math.min(maxPoints, Math.max(0, Math.round(action.earnedPoints)));
        const prevEarned = task.earnedPoints ?? 0;
        delta = nextEarned - prevEarned;
        const nextNoteRaw = typeof action.note === "string" ? action.note.trim() : task.note;
        const nextNote = nextNoteRaw ? nextNoteRaw : undefined;
        return { ...task, earnedPoints: nextEarned, settledAt: Date.now(), note: nextNote };
      });
      return {
        ...state,
        tasks,
        points: clampPoints(state.points + delta)
      };
    }
    case "SET_TASK_DEADLINE": {
      const tasks = state.tasks.map((task) => {
        if (task.id !== action.taskId) return task;
        if (task.planType !== "longterm") return task;
        return { ...task, deadlineDate: action.deadlineDate?.trim() || undefined };
      });
      return { ...state, tasks };
    }
    case "ADD_TEMPLATE": {
      const exists = state.templates.some(
        (item) =>
          item.groupId === action.template.groupId &&
          item.planType === action.template.planType &&
          item.title === action.template.title &&
          item.maxPoints === action.template.maxPoints
      );
      if (exists) return state;
      return { ...state, templates: [action.template, ...state.templates] };
    }
    case "TOGGLE_TEMPLATE_AUTO": {
      const templates = state.templates.map((item) => {
        if (item.id !== action.templateId) return item;
        if (item.planType !== "daily") return item;
        if (!action.enabled) {
          return { ...item, autoDaily: false };
        }
        return { ...item, autoDaily: true, autoRule: item.autoRule ?? "daily" };
      });
      let tasks = state.tasks;
      if (!action.enabled) {
        tasks = state.tasks.map((task) =>
          task.sourceTemplateId === action.templateId
            ? { ...task, sourceTemplateId: undefined }
            : task
        );
      }
      return { ...state, templates, tasks };
    }
    case "SET_TEMPLATE_AUTO_RULE": {
      const templates = state.templates.map((item) => {
        if (item.id !== action.templateId) return item;
        if (item.planType !== "daily") return item;
        if (!item.autoDaily) return item;
        return { ...item, autoRule: action.rule };
      });
      return { ...state, templates };
    }
    case "DELETE_TEMPLATE": {
      const remainingTemplates = state.templates.filter((item) => item.id !== action.templateId);
      const unlinkTasks = state.tasks.map((task) =>
        task.sourceTemplateId === action.templateId
          ? { ...task, sourceTemplateId: undefined }
          : task
      );
      return { ...state, templates: remainingTemplates, tasks: unlinkTasks };
    }
    case "LINK_TASK_TO_TEMPLATE": {
      const linkedTasks = state.tasks.map((task) =>
        task.id === action.taskId
          ? { ...task, sourceTemplateId: action.templateId }
          : task
      );
      return { ...state, tasks: linkedTasks };
    }
    case "DELETE_TASK": {
      const target = state.tasks.find((task) => task.id === action.taskId);
      const tasks = state.tasks.filter((task) => task.id !== action.taskId);
      const earnedValue =
        target?.earnedPoints ?? (target && target.completed ? target.maxPoints : 0);
      const points = target ? clampPoints(state.points - earnedValue) : state.points;
      return {
        ...state,
        tasks,
        points,
        notificationSettings: {
          ...state.notificationSettings,
          taskIds: state.notificationSettings.taskIds.filter((taskId) => taskId !== action.taskId)
        },
        longtermNotificationSettings: {
          ...state.longtermNotificationSettings,
          taskIds: state.longtermNotificationSettings.taskIds.filter((taskId) => taskId !== action.taskId)
        }
      };
    }
    case "CLEANUP_OLD_RECORDS": {
      const cutoffDate = action.cutoffDate.trim();
      if (!cutoffDate) return state;
      const tasks = state.tasks.filter((task) => {
        if (task.earnedPoints === null) return true;
        let dateKey: string | null = null;
        if (typeof task.settledAt === "number") {
          const date = new Date(task.settledAt);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          dateKey = `${year}-${month}-${day}`;
        } else if (task.planType === "daily" && task.targetDate) {
          dateKey = task.targetDate;
        }
        if (!dateKey) return true;
        return dateKey >= cutoffDate;
      });
      return { ...state, tasks };
    }
    default:
      return state;
  }
}
