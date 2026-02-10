import React, { useEffect, useMemo, useReducer, useState } from "react";
import {
  AppState,
  Alert,
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
  Dimensions
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Notifications from "expo-notifications";
import {
  DEFAULT_GROUP_ID,
  AutoRule,
  LongtermReminderIntervalRule,
  NotificationMode,
  NotificationDateMode,
  NotificationRepeatRule,
  PlanType,
  Task,
  TaskGroup,
  TaskTemplate,
  initialState,
  makeId,
  reducer
} from "./state";
import { loadState, saveState } from "./storage";
import { theme } from "./theme";

const GROUP_COLORS = [
  { id: "teal-deep", label: "深青", value: "#0E7490" },
  { id: "teal-mid", label: "青色", value: "#0F766E" },
  { id: "teal-light", label: "浅青", value: "#14B8A6" },
  { id: "blue-deep", label: "深蓝", value: "#1D4ED8" },
  { id: "blue-mid", label: "蓝色", value: "#2563EB" },
  { id: "blue-light", label: "浅蓝", value: "#3B82F6" },
  { id: "green-deep", label: "深绿", value: "#15803D" },
  { id: "green-mid", label: "绿色", value: "#16A34A" },
  { id: "green-light", label: "浅绿", value: "#22C55E" },
  { id: "orange-deep", label: "深橙", value: "#EA580C" },
  { id: "orange-mid", label: "橙色", value: "#F97316" },
  { id: "orange-light", label: "浅橙", value: "#FB923C" },
  { id: "rose", label: "玫红", value: "#E11D48" },
  { id: "slate", label: "灰色", value: "#64748B" }
];

const AUTO_RULE_OPTIONS: Array<{ value: AutoRule; label: string }> = [
  { value: "daily", label: "每日" },
  { value: "weekday", label: "工作日" },
  { value: "weekend", label: "周末" }
];

const TASK_TYPE_OPTIONS: PlanType[] = ["daily", "longterm"];
const TASK_TYPE_LABELS: Record<PlanType, string> = {
  daily: "每日任务",
  longterm: "长期任务"
};
const REMINDER_DATE_OPTIONS: Array<{ value: NotificationDateMode; label: string }> = [
  { value: "today", label: "今天" },
  { value: "tomorrow", label: "明天" }
];
const LONGTERM_INTERVAL_OPTIONS: Array<{ value: LongtermReminderIntervalRule; label: string }> = [
  { value: "none", label: "关闭" },
  { value: "weekly", label: "每周" },
  { value: "every14Days", label: "14天" },
  { value: "every30Days", label: "30天" }
];
const LONGTERM_DEADLINE_OFFSET_OPTIONS = [
  { value: 7, label: "提前7天" },
  { value: 3, label: "提前3天" },
  { value: 1, label: "提前1天" },
  { value: 0, label: "当天" }
];
const REMINDER_SCHEDULE_DAYS = 30;
const LONGTERM_REMINDER_SCHEDULE_DAYS = 90;
const TREND_DAYS_BEFORE_TODAY = 7;
const TREND_DAYS_AFTER_TODAY = 7;
const CALENDAR_HEAT_BASE_COLOR = "#2563EB";

const GRID_SPACING = 24;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKeyFromTimestamp(timestamp: number): string {
  return formatLocalDate(new Date(timestamp));
}

function parseDateKey(dateKey: string): Date | null {
  const [y, m, d] = dateKey.split("-").map((value) => Number(value));
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return startOfDay(date);
}

function buildReminderMessage(tasks: Array<Pick<Task, "title">>): { title: string; body: string } {
  if (tasks.length === 0) {
    return { title: "任务提醒", body: "暂无已选择的提醒任务" };
  }
  const preview = tasks.slice(0, 3).map((task) => `• ${task.title}`).join("\n");
  const suffix = tasks.length > 3 ? `\n等 ${tasks.length} 项` : `\n共 ${tasks.length} 项`;
  return { title: "任务提醒", body: `${preview}${suffix}` };
}

function buildReminderSyncFingerprint(
  settings: {
    enabled: boolean;
    periodicHour: number;
    periodicMinute: number;
    singleHour: number;
    singleMinute: number;
    mode: NotificationMode;
    dateMode: NotificationDateMode;
    repeatRule: NotificationRepeatRule;
  },
  tasks: Array<{ id: string; title: string; autoRule?: AutoRule }>
): string {
  const taskPart = [...tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((task) => `${task.id}:${task.title}:${task.autoRule ?? ""}`)
    .join("|");
  return [
    settings.enabled ? "1" : "0",
    String(settings.periodicHour),
    String(settings.periodicMinute),
    String(settings.singleHour),
    String(settings.singleMinute),
    settings.mode,
    settings.dateMode,
    settings.repeatRule,
    taskPart
  ].join("~");
}

function buildLongtermReminderSyncFingerprint(
  settings: {
    enabled: boolean;
    hour: number;
    minute: number;
    deadlineOffsets: number[];
    intervalRule: LongtermReminderIntervalRule;
  },
  tasks: Array<{ id: string; title: string; deadlineDate: string }>
): string {
  const taskPart = [...tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((task) => `${task.id}:${task.deadlineDate}:${task.title}`)
    .join("|");
  const offsetPart = [...settings.deadlineOffsets].sort((a, b) => b - a).join(",");
  return [
    settings.enabled ? "1" : "0",
    String(settings.hour),
    String(settings.minute),
    offsetPart,
    settings.intervalRule,
    taskPart
  ].join("~");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function buildUpcomingReminderDates(
  hour: number,
  minute: number,
  days: number,
  repeatRule: NotificationRepeatRule
): Date[] {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (first.getTime() <= now.getTime()) {
    first.setDate(first.getDate() + 1);
  }
  const maxDays = Math.max(1, days);
  const dates: Date[] = [];
  for (let offset = 0; offset < maxDays; offset += 1) {
    const date = new Date(first);
    date.setDate(first.getDate() + offset);
    if (repeatRule === "weekday") {
      const weekday = date.getDay();
      if (weekday === 0 || weekday === 6) continue;
    }
    dates.push(date);
  }
  return dates;
}

function buildOnceReminderDate(dateMode: NotificationDateMode, hour: number, minute: number): Date {
  const now = new Date();
  const dayOffset = dateMode === "today" ? 0 : 1;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0);
}

function repeatRuleLabel(rule: NotificationRepeatRule): string {
  if (rule === "once") return "单次";
  if (rule === "weekday") return "工作日";
  return "每天";
}

function dateModeLabel(mode: NotificationDateMode): string {
  return mode === "today" ? "今天" : "明天";
}

function longtermIntervalLabel(rule: LongtermReminderIntervalRule): string {
  if (rule === "weekly") return "每周";
  if (rule === "every14Days") return "每14天";
  if (rule === "every30Days") return "每30天";
  return "关闭";
}

function daysBetween(startDate: Date, endDate: Date): number {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function buildLongtermReminderDates(
  hour: number,
  minute: number,
  days: number,
  intervalRule: LongtermReminderIntervalRule
): Date[] {
  if (intervalRule === "none") return [];
  const step = intervalRule === "weekly" ? 7 : intervalRule === "every14Days" ? 14 : 30;
  const maxDays = Math.max(1, days);
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (first.getTime() <= now.getTime()) {
    first.setDate(first.getDate() + 1);
  }
  const dates: Date[] = [];
  for (let offset = 0; offset < maxDays; offset += step) {
    const date = new Date(first);
    date.setDate(first.getDate() + offset);
    dates.push(date);
  }
  return dates;
}

type DeadlinePickerTarget = { kind: "create" } | { kind: "task"; taskId: string };
const WHEEL_ITEM_HEIGHT = 36;
const WHEEL_VISIBLE_ROWS = 5;
const WHEEL_CONTENT_PADDING = ((WHEEL_VISIBLE_ROWS - 1) / 2) * WHEEL_ITEM_HEIGHT;

export function HomeScreen() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [activeGroupId, setActiveGroupId] = useState(DEFAULT_GROUP_ID);
  const [newTaskType, setNewTaskType] = useState<PlanType>("daily");
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<"create" | "rename">("create");
  const [groupModalName, setGroupModalName] = useState("");
  const [groupModalColor, setGroupModalColor] = useState(GROUP_COLORS[0].value);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPoints, setTaskPoints] = useState("");
  const [taskDetailNote, setTaskDetailNote] = useState("");
  const [longtermDeadlineDraft, setLongtermDeadlineDraft] = useState("");
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const noticeAnim = React.useRef(new Animated.Value(0)).current;
  const noticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fabDockTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fabDockAnim = React.useRef(new Animated.Value(1)).current;
  const [isDeadlinePickerOpen, setIsDeadlinePickerOpen] = useState(false);
  const [deadlinePickerTarget, setDeadlinePickerTarget] = useState<DeadlinePickerTarget | null>(null);
  const [deadlinePickerYear, setDeadlinePickerYear] = useState(new Date().getFullYear());
  const [deadlinePickerMonth, setDeadlinePickerMonth] = useState(new Date().getMonth() + 1);
  const [deadlinePickerDay, setDeadlinePickerDay] = useState(new Date().getDate());
  const yearWheelRef = React.useRef<ScrollView | null>(null);
  const monthWheelRef = React.useRef<ScrollView | null>(null);
  const dayWheelRef = React.useRef<ScrollView | null>(null);
  const [isCreateTemplateDropdownOpen, setIsCreateTemplateDropdownOpen] = useState(false);
  const [createFromTemplateId, setCreateFromTemplateId] = useState<string | null>(null);
  const [dailyTargetKey, setDailyTargetKey] = useState(() => formatLocalDate(addDays(new Date(), 1)));
  const [earnedDrafts, setEarnedDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [expandedSettleRows, setExpandedSettleRows] = useState<Record<string, boolean>>({});
  const [taskListTab, setTaskListTab] = useState<"today" | "tomorrow">("today");
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [activeChart, setActiveChart] = useState<"line" | "calendar">("line");
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [isFabDocked, setIsFabDocked] = useState(true);
  const [templateTab, setTemplateTab] = useState<PlanType>("daily");
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archiveDaysDraft, setArchiveDaysDraft] = useState("30");
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [reminderPanel, setReminderPanel] = useState<"daily" | "longterm">("daily");
  const [dailyReminderTaskPage, setDailyReminderTaskPage] = useState<"periodic" | "single">("periodic");
  const [reminderEnabledDraft, setReminderEnabledDraft] = useState(true);
  const [periodicReminderHourDraft, setPeriodicReminderHourDraft] = useState("08");
  const [periodicReminderMinuteDraft, setPeriodicReminderMinuteDraft] = useState("00");
  const [singleReminderHourDraft, setSingleReminderHourDraft] = useState("08");
  const [singleReminderMinuteDraft, setSingleReminderMinuteDraft] = useState("00");
  const [reminderTaskIdsDraft, setReminderTaskIdsDraft] = useState<string[]>([]);
  const [reminderDateModeDraft, setReminderDateModeDraft] = useState<NotificationDateMode>("tomorrow");
  const [longtermReminderEnabledDraft, setLongtermReminderEnabledDraft] = useState(false);
  const [longtermReminderHourDraft, setLongtermReminderHourDraft] = useState("20");
  const [longtermReminderMinuteDraft, setLongtermReminderMinuteDraft] = useState("00");
  const [longtermReminderTaskIdsDraft, setLongtermReminderTaskIdsDraft] = useState<string[]>([]);
  const [longtermReminderOffsetsDraft, setLongtermReminderOffsetsDraft] = useState<number[]>([7, 3, 1, 0]);
  const [longtermReminderIntervalDraft, setLongtermReminderIntervalDraft] =
    useState<LongtermReminderIntervalRule>("weekly");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDayDetailOpen, setIsDayDetailOpen] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const rewardAnim = React.useRef(new Animated.Value(0)).current;
  const [rewardBurst, setRewardBurst] = useState<number | null>(null);
  const reminderSyncRunRef = React.useRef(0);
  const lastReminderSyncFingerprintRef = React.useRef<string | null>(null);
  const longtermReminderSyncRunRef = React.useRef(0);
  const lastLongtermReminderSyncFingerprintRef = React.useRef<string | null>(null);
  const appStateRef = React.useRef(AppState.currentState);
  const lastReminderResyncDateRef = React.useRef(formatLocalDate(new Date()));
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    action:
    | { type: "deleteGroup"; groupId: string }
    | { type: "deleteTask"; taskId: string }
    | { type: "deleteTemplate"; templateId: string };
  } | null>(null);
  const todayKey = formatLocalDate(new Date());
  const tomorrowKey = formatLocalDate(addDays(new Date(), 1));

  async function ensureNotificationPermissionAndChannel(showFailureAlert = false): Promise<boolean> {
    try {
      const current = await Notifications.getPermissionsAsync();
      let granted = current.granted;
      if (!granted) {
        const requested = await Notifications.requestPermissionsAsync();
        granted = requested.granted;
      }
      if (!granted) {
        if (showFailureAlert) {
          Alert.alert("通知未开启", "请在系统设置中允许 Action+ 发送通知");
        }
        return false;
      }
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("task-list", {
          name: "任务清单",
          importance: Notifications.AndroidImportance.HIGH
        });
      }
      return true;
    } catch (error) {
      if (showFailureAlert) {
        Alert.alert("通知异常", "通知服务初始化失败，请稍后重试");
      }
      return false;
    }
  }

  async function syncTaskReminderSchedule(
    settings: {
      enabled: boolean;
      periodicHour: number;
      periodicMinute: number;
      singleHour: number;
      singleMinute: number;
      taskIds: string[];
      mode: NotificationMode;
      dateMode: NotificationDateMode;
      repeatRule: NotificationRepeatRule;
    },
    reminderTasks: Array<{ id: string; title: string; autoRule?: AutoRule }>,
    scheduleFingerprint: string,
    showResultNotice = false,
    forceSync = false
  ): Promise<void> {
    if (!forceSync && lastReminderSyncFingerprintRef.current === scheduleFingerprint) {
      return;
    }
    const runId = ++reminderSyncRunRef.current;
    const ready = await ensureNotificationPermissionAndChannel(showResultNotice);
    if (!ready) return;
    try {
      if (runId !== reminderSyncRunRef.current) return;
      const existing = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        existing
          .filter((item) => item.content?.data?.type === "task_reminder")
          .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
      );
      if (runId !== reminderSyncRunRef.current) return;

      if (!settings.enabled) {
        lastReminderSyncFingerprintRef.current = scheduleFingerprint;
        if (showResultNotice) showShortNotice("提醒已关闭");
        return;
      }

      if (reminderTasks.length === 0) {
        lastReminderSyncFingerprintRef.current = scheduleFingerprint;
        if (showResultNotice) {
          Alert.alert("未设置每日提醒任务", "请至少勾选 1 个每日任务后再保存提醒");
        }
        return;
      }

      const periodicTasks = reminderTasks.filter((task) => typeof task.autoRule === "string");
      const singleTasks = reminderTasks.filter((task) => typeof task.autoRule !== "string");
      let scheduledCount = 0;
      if (singleTasks.length > 0) {
        const singleTargetDate = buildOnceReminderDate(settings.dateMode, settings.singleHour, settings.singleMinute);
        if (singleTargetDate.getTime() > Date.now()) {
          const singleMessage = buildReminderMessage(singleTasks);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: singleMessage.title,
              body: singleMessage.body,
              data: {
                type: "task_reminder",
                taskIds: singleTasks.map((task) => task.id),
                dateMode: settings.dateMode,
                repeatRule: "single_once"
              }
            },
            trigger: {
              channelId: Platform.OS === "android" ? "task-list" : undefined,
              date: singleTargetDate
            }
          });
          scheduledCount += 1;
        }
      }
      const periodicMessage = buildReminderMessage(periodicTasks);
      if (periodicTasks.length > 0 && settings.mode === "follow_task") {
        const upcomingDates = buildUpcomingReminderDates(
          settings.periodicHour,
          settings.periodicMinute,
          REMINDER_SCHEDULE_DAYS,
          "daily"
        );
        await Promise.all(
          upcomingDates.map((date, index) => {
            const tasksForDate = periodicTasks.filter((task) => isRuleMatch(task.autoRule, date));
            if (tasksForDate.length === 0) return Promise.resolve();
            const message = buildReminderMessage(tasksForDate);
            scheduledCount += 1;
            return Notifications.scheduleNotificationAsync({
              content: {
                title: message.title,
                body: message.body,
                data: {
                  type: "task_reminder",
                  taskIds: tasksForDate.map((task) => task.id),
                  dayOffset: index,
                  repeatRule: "follow_task"
                }
              },
              trigger: {
                channelId: Platform.OS === "android" ? "task-list" : undefined,
                date
              }
            });
          })
        );
      } else if (periodicTasks.length > 0 && settings.repeatRule === "once") {
        const targetDate = buildOnceReminderDate(settings.dateMode, settings.periodicHour, settings.periodicMinute);
        if (targetDate.getTime() <= Date.now()) {
          if (singleTasks.length === 0) {
            lastReminderSyncFingerprintRef.current = scheduleFingerprint;
            if (showResultNotice) {
              Alert.alert("时间已过", "单次提醒请设置为未来时间");
            }
            return;
          }
        } else {
          scheduledCount += 1;
          await Notifications.scheduleNotificationAsync({
            content: {
              title: periodicMessage.title,
              body: periodicMessage.body,
              data: {
                type: "task_reminder",
                taskIds: periodicTasks.map((task) => task.id),
                repeatRule: settings.repeatRule,
                dateMode: settings.dateMode
              }
            },
            trigger: {
              channelId: Platform.OS === "android" ? "task-list" : undefined,
              date: targetDate
            }
          });
        }
      } else if (periodicTasks.length > 0) {
        const upcomingDates = buildUpcomingReminderDates(
          settings.periodicHour,
          settings.periodicMinute,
          REMINDER_SCHEDULE_DAYS,
          settings.repeatRule
        );
        await Promise.all(
          upcomingDates.map((date, index) =>
            (() => {
              scheduledCount += 1;
              return Notifications.scheduleNotificationAsync({
                content: {
                  title: periodicMessage.title,
                  body: periodicMessage.body,
                  data: {
                    type: "task_reminder",
                    taskIds: periodicTasks.map((task) => task.id),
                    dayOffset: index,
                    repeatRule: settings.repeatRule
                  }
                },
                trigger: {
                  channelId: Platform.OS === "android" ? "task-list" : undefined,
                  date
                }
              });
            })()
          )
        );
      }
      if (scheduledCount === 0) {
        lastReminderSyncFingerprintRef.current = scheduleFingerprint;
        if (showResultNotice) {
          Alert.alert("未创建提醒", "当前提醒时间已过或无匹配任务，请调整后重试");
        }
        return;
      }
      if (runId !== reminderSyncRunRef.current) return;
      lastReminderSyncFingerprintRef.current = scheduleFingerprint;

      if (showResultNotice) {
        const modeText =
          settings.mode === "follow_task"
            ? `周期 ${pad2(settings.periodicHour)}:${pad2(settings.periodicMinute)} / 单次 ${dateModeLabel(settings.dateMode)} ${pad2(settings.singleHour)}:${pad2(settings.singleMinute)}`
            : `单次 ${dateModeLabel(settings.dateMode)} ${pad2(settings.singleHour)}:${pad2(settings.singleMinute)}`;
        showShortNotice(`提醒已设置 ${modeText}`);
      }
    } catch (error) {
      if (showResultNotice) {
        Alert.alert("提醒设置失败", "未能成功创建提醒，请稍后重试");
      }
    }
  }

  async function syncLongtermReminderSchedule(
    settings: {
      enabled: boolean;
      hour: number;
      minute: number;
      taskIds: string[];
      deadlineOffsets: number[];
      intervalRule: LongtermReminderIntervalRule;
    },
    reminderTasks: Array<{ id: string; title: string; deadlineDate: string }>,
    scheduleFingerprint: string,
    showResultNotice = false,
    forceSync = false
  ): Promise<void> {
    if (!forceSync && lastLongtermReminderSyncFingerprintRef.current === scheduleFingerprint) {
      return;
    }
    const runId = ++longtermReminderSyncRunRef.current;
    const ready = await ensureNotificationPermissionAndChannel(showResultNotice);
    if (!ready) return;
    try {
      if (runId !== longtermReminderSyncRunRef.current) return;
      const existing = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        existing
          .filter((item) => item.content?.data?.type === "longterm_task_reminder")
          .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
      );
      if (runId !== longtermReminderSyncRunRef.current) return;

      if (!settings.enabled) {
        lastLongtermReminderSyncFingerprintRef.current = scheduleFingerprint;
        if (showResultNotice) showShortNotice("长期提醒已关闭");
        return;
      }

      if (reminderTasks.length === 0) {
        lastLongtermReminderSyncFingerprintRef.current = scheduleFingerprint;
        if (showResultNotice) {
          Alert.alert("未设置长期提醒任务", "请至少勾选 1 个带截止日期的长期任务");
        }
        return;
      }

      const now = new Date();
      const selectedTaskIds = reminderTasks.map((task) => task.id);
      const seenTriggerKeys = new Set<string>();
      const scheduleEntries: Array<{
        taskId: string;
        taskTitle: string;
        date: Date;
        reason: string;
      }> = [];

      for (const task of reminderTasks) {
        const deadlineDate = parseDateKey(task.deadlineDate);
        if (deadlineDate) {
          for (const offset of settings.deadlineOffsets) {
            const triggerDate = new Date(
              deadlineDate.getFullYear(),
              deadlineDate.getMonth(),
              deadlineDate.getDate() - offset,
              settings.hour,
              settings.minute,
              0,
              0
            );
            if (triggerDate.getTime() <= now.getTime()) continue;
            if (daysBetween(now, triggerDate) > LONGTERM_REMINDER_SCHEDULE_DAYS) continue;
            const key = `${task.id}|deadline|${formatLocalDate(triggerDate)}|${settings.hour}|${settings.minute}`;
            if (seenTriggerKeys.has(key)) continue;
            seenTriggerKeys.add(key);
            scheduleEntries.push({
              taskId: task.id,
              taskTitle: task.title,
              date: triggerDate,
              reason: offset === 0 ? "截止日当天" : `距截止 ${offset} 天`
            });
          }
        }
      }

      const intervalDates = buildLongtermReminderDates(
        settings.hour,
        settings.minute,
        LONGTERM_REMINDER_SCHEDULE_DAYS,
        settings.intervalRule
      );
      if (settings.intervalRule !== "none") {
        for (const date of intervalDates) {
          const key = `interval|${formatLocalDate(date)}|${settings.hour}|${settings.minute}`;
          if (seenTriggerKeys.has(key)) continue;
          seenTriggerKeys.add(key);
          scheduleEntries.push({
            taskId: "all",
            taskTitle: "长期任务",
            date,
            reason: `${longtermIntervalLabel(settings.intervalRule)}回顾`
          });
        }
      }

      await Promise.all(
        scheduleEntries.map((entry) =>
          Notifications.scheduleNotificationAsync({
            content: {
              title: "长期任务提醒",
              body:
                entry.taskId === "all"
                  ? `请回顾长期任务进度（共 ${reminderTasks.length} 项）`
                  : `「${entry.taskTitle}」${entry.reason}`,
              data: {
                type: "longterm_task_reminder",
                taskIds: selectedTaskIds,
                taskId: entry.taskId,
                reason: entry.reason
              }
            },
            trigger: {
              channelId: Platform.OS === "android" ? "task-list" : undefined,
              date: entry.date
            }
          })
        )
      );

      if (runId !== longtermReminderSyncRunRef.current) return;
      lastLongtermReminderSyncFingerprintRef.current = scheduleFingerprint;

      if (showResultNotice) {
        showShortNotice(`长期提醒已设置 ${scheduleEntries.length} 条`);
      }
    } catch (error) {
      if (showResultNotice) {
        Alert.alert("长期提醒设置失败", "未能成功创建长期提醒，请稍后重试");
      }
    }
  }

  async function handleTestReminderNotification(kind: "periodic" | "single") {
    const ready = await ensureNotificationPermissionAndChannel(true);
    if (!ready) return;
    const selectedPeriodicGroups =
      kind === "periodic"
        ? periodicReminderDisplayOptions.filter((item) =>
          item.taskIds.every((taskId) => reminderTaskIdsDraft.includes(taskId))
        )
        : [];
    const selectedSingleTasks =
      kind === "single" ? singleReminderTaskOptions.filter((task) => reminderTaskIdsDraft.includes(task.id)) : [];
    const selectedTaskIds =
      kind === "periodic"
        ? Array.from(new Set(selectedPeriodicGroups.flatMap((item) => item.taskIds)))
        : selectedSingleTasks.map((task) => task.id);
    const messageTasks =
      kind === "periodic"
        ? selectedPeriodicGroups.map((item) => ({ title: item.title }))
        : selectedSingleTasks.map((task) => ({ title: task.title }));
    if (messageTasks.length === 0) {
      Alert.alert(
        "未选择任务",
        kind === "periodic" ? "请至少勾选 1 个周期任务后再测试" : "请至少勾选 1 个单次任务后再测试"
      );
      return;
    }
    try {
      const message = buildReminderMessage(messageTasks);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: kind === "periodic" ? "周期任务提醒测试" : "单次任务提醒测试",
          body: message.body,
          data: {
            type: "task_reminder_test",
            kind,
            taskIds: selectedTaskIds
          }
        },
        trigger: {
          channelId: Platform.OS === "android" ? "task-list" : undefined,
          seconds: 5,
          repeats: false
        }
      });
      showShortNotice(`${kind === "periodic" ? "周期任务" : "单次任务"}测试通知将在 5 秒后触发`);
    } catch (error) {
      Alert.alert("测试失败", "无法创建测试通知，请稍后重试");
    }
  }

  useEffect(() => {
    let isMounted = true;
    loadState().then((loaded) => {
      if (!isMounted) return;
      dispatch({ type: "LOAD_STATE", state: loaded });
      setIsReady(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      if (fabDockTimerRef.current) {
        clearTimeout(fabDockTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    Animated.timing(fabDockAnim, {
      toValue: isFabDocked ? 1 : 0,
      duration: 220,
      useNativeDriver: true
    }).start();
  }, [isFabDocked, fabDockAnim]);

  useEffect(() => {
    if (!isReady) return;
    saveState(state);
  }, [state, isReady]);

  useEffect(() => {
    if (isTaskModalOpen) {
      setDailyTargetKey(tomorrowKey);
    }
  }, [isTaskModalOpen, tomorrowKey]);

  useEffect(() => {
    if (!isReady) return;
    const setupNotifications = async () => {
      await ensureNotificationPermissionAndChannel(false);
    };
    setupNotifications();
  }, [isReady]);

  const groups = useMemo(() => state.groups, [state.groups]);
  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? groups[0],
    [groups, activeGroupId]
  );
  const activeGroupColor = activeGroup?.color ?? theme.colors.accent;

  useEffect(() => {
    if (groups.length === 0) return;
    const exists = groups.some((group) => group.id === activeGroupId);
    if (!exists) {
      setActiveGroupId(groups[0].id);
    }
  }, [groups, activeGroupId]);


  const allTasks = useMemo(() => state.tasks, [state.tasks]);

  const dailyTasks = useMemo(
    () => allTasks.filter((task) => task.planType === "daily"),
    [allTasks]
  );

  const longtermTasks = useMemo(
    () => allTasks.filter((task) => task.planType === "longterm"),
    [allTasks]
  );

  const todayTasks = useMemo(() => {
    return dailyTasks
      .filter((task) => task.targetDate === todayKey)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [dailyTasks, todayKey]);

  const tomorrowTasks = useMemo(() => {
    return dailyTasks
      .filter((task) => task.targetDate === tomorrowKey)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [dailyTasks, tomorrowKey]);

  const settlementTasks = useMemo(() => {
    return dailyTasks
      .filter((task) => typeof task.targetDate === "string" && task.targetDate <= todayKey)
      .sort((a, b) => {
        if (a.targetDate !== b.targetDate) return (b.targetDate ?? "").localeCompare(a.targetDate ?? "");
        return b.createdAt - a.createdAt;
      });
  }, [dailyTasks, todayKey]);

  const settledCount = settlementTasks.filter((task) => task.earnedPoints !== null).length;
  const todayPoints = useMemo(() => {
    const start = startOfDay(new Date()).getTime();
    const end = startOfDay(addDays(new Date(), 1)).getTime();
    const allTasks = [...dailyTasks, ...longtermTasks];
    return allTasks.reduce((sum, task) => {
      if (task.earnedPoints === null) return sum;
      if (typeof task.settledAt === "number") {
        if (task.settledAt >= start && task.settledAt < end) {
          return sum + task.earnedPoints;
        }
        return sum;
      }
      if (task.planType === "daily" && task.targetDate === todayKey) {
        return sum + task.earnedPoints;
      }
      return sum;
    }, 0);
  }, [dailyTasks, longtermTasks, todayKey]);

  const archives = useMemo(() => state.archives ?? [], [state.archives]);
  const archiveSettings = state.archiveSettings ?? { cycleDays: 30, periodStart: null };
  const notificationSettings = state.notificationSettings ?? {
    enabled: true,
    hour: 8,
    minute: 0,
    taskIds: [],
    mode: "global_rule" as NotificationMode,
    dateMode: "tomorrow" as NotificationDateMode,
    repeatRule: "daily" as NotificationRepeatRule
  };
  const longtermNotificationSettings = state.longtermNotificationSettings ?? {
    enabled: false,
    hour: 20,
    minute: 0,
    taskIds: [],
    deadlineOffsets: [7, 3, 1, 0],
    intervalRule: "weekly" as LongtermReminderIntervalRule
  };
  const reminderSummary =
    notificationSettings.mode === "follow_task"
      ? `周期 ${pad2(notificationSettings.periodicHour)}:${pad2(notificationSettings.periodicMinute)} / 单次 ${dateModeLabel(notificationSettings.dateMode)} ${pad2(notificationSettings.singleHour)}:${pad2(notificationSettings.singleMinute)}`
      : `单次 ${dateModeLabel(notificationSettings.dateMode)} ${pad2(notificationSettings.singleHour)}:${pad2(notificationSettings.singleMinute)}`;
  const dailyTaskIdSet = useMemo(() => new Set(dailyTasks.map((task) => task.id)), [dailyTasks]);
  const reminderTaskOptions = useMemo(() => {
    return [...dailyTasks]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((task) => ({
        id: task.id,
        title: task.title,
        planType: task.planType,
        groupId: task.groupId,
        maxPoints: task.maxPoints,
        targetDate: task.targetDate ?? "",
        sourceTemplateId: task.sourceTemplateId,
        autoRule: task.sourceTemplateId
          ? state.templates.find((item) => item.id === task.sourceTemplateId)?.autoRule
          : undefined
      }));
  }, [dailyTasks, state.templates]);
  const periodicReminderTaskOptions = useMemo(
    () => reminderTaskOptions.filter((task) => typeof task.autoRule === "string"),
    [reminderTaskOptions]
  );
  const periodicReminderDisplayOptions = useMemo(() => {
    const merged = new Map<
      string,
      {
        key: string;
        title: string;
        groupId: string;
        maxPoints: number;
        autoRule?: AutoRule;
        taskIds: string[];
      }
    >();
    periodicReminderTaskOptions.forEach((task) => {
      const key = task.sourceTemplateId ?? `${task.groupId}|${task.title}|${task.maxPoints}|${task.autoRule ?? ""}`;
      const existing = merged.get(key);
      if (existing) {
        if (!existing.taskIds.includes(task.id)) {
          existing.taskIds.push(task.id);
        }
        return;
      }
      merged.set(key, {
        key,
        title: task.title,
        groupId: task.groupId,
        maxPoints: task.maxPoints,
        autoRule: task.autoRule,
        taskIds: [task.id]
      });
    });
    return Array.from(merged.values());
  }, [periodicReminderTaskOptions]);
  const singleReminderTaskOptions = useMemo(() => {
    const targetKey = reminderDateModeDraft === "today" ? todayKey : tomorrowKey;
    return reminderTaskOptions.filter(
      (task) => typeof task.autoRule !== "string" && task.targetDate === targetKey
    );
  }, [reminderTaskOptions, reminderDateModeDraft, todayKey, tomorrowKey]);
  const reminderTaskOptionIdSet = useMemo(
    () => new Set([...periodicReminderTaskOptions, ...singleReminderTaskOptions].map((task) => task.id)),
    [periodicReminderTaskOptions, singleReminderTaskOptions]
  );
  const hasPeriodicReminderTasks = useMemo(
    () => periodicReminderTaskOptions.length > 0,
    [periodicReminderTaskOptions]
  );
  useEffect(() => {
    setReminderTaskIdsDraft((prev) => prev.filter((taskId) => reminderTaskOptionIdSet.has(taskId)));
  }, [reminderTaskOptionIdSet]);
  useEffect(() => {
    if (hasPeriodicReminderTasks) return;
    setDailyReminderTaskPage("single");
  }, [hasPeriodicReminderTasks]);
  const reminderTasksForSchedule = useMemo(() => {
    const idSet = new Set(notificationSettings.taskIds);
    return dailyTasks
      .filter((task) => idSet.has(task.id))
      .map((task) => ({
        id: task.id,
        title: task.title,
        autoRule: task.sourceTemplateId
          ? state.templates.find((item) => item.id === task.sourceTemplateId)?.autoRule
          : undefined
      }));
  }, [dailyTasks, notificationSettings.taskIds, state.templates]);
  const longtermTaskIdSet = useMemo(
    () =>
      new Set(
        longtermTasks
          .filter((task) => typeof task.deadlineDate === "string" && task.deadlineDate.trim().length > 0)
          .map((task) => task.id)
      ),
    [longtermTasks]
  );
  const longtermReminderTaskOptions = useMemo(() => {
    return longtermTasks
      .filter((task) => typeof task.deadlineDate === "string" && task.deadlineDate.trim().length > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((task) => ({
        id: task.id,
        title: task.title,
        groupId: task.groupId,
        deadlineDate: task.deadlineDate ?? ""
      }));
  }, [longtermTasks]);
  const longtermReminderTaskOptionIdSet = useMemo(
    () => new Set(longtermReminderTaskOptions.map((task) => task.id)),
    [longtermReminderTaskOptions]
  );
  useEffect(() => {
    setLongtermReminderTaskIdsDraft((prev) => prev.filter((taskId) => longtermReminderTaskOptionIdSet.has(taskId)));
  }, [longtermReminderTaskOptionIdSet]);
  const longtermReminderTasksForSchedule = useMemo(() => {
    const idSet = new Set(longtermNotificationSettings.taskIds);
    return longtermReminderTaskOptions
      .filter((task) => idSet.has(task.id))
      .map((task) => ({ id: task.id, title: task.title, deadlineDate: task.deadlineDate }));
  }, [longtermReminderTaskOptions, longtermNotificationSettings.taskIds]);
  const longtermReminderSummary = useMemo(() => {
    const offsetText = longtermNotificationSettings.deadlineOffsets.length
      ? longtermNotificationSettings.deadlineOffsets
        .slice()
        .sort((a, b) => b - a)
        .map((offset) => (offset === 0 ? "当天" : `提前${offset}天`))
        .join("/")
      : "无";
    return `${pad2(longtermNotificationSettings.hour)}:${pad2(longtermNotificationSettings.minute)} · 截止提醒 ${offsetText} · 周期 ${longtermIntervalLabel(
      longtermNotificationSettings.intervalRule
    )}`;
  }, [
    longtermNotificationSettings.hour,
    longtermNotificationSettings.minute,
    longtermNotificationSettings.deadlineOffsets,
    longtermNotificationSettings.intervalRule
  ]);
  const longtermReminderSyncFingerprint = useMemo(
    () =>
      buildLongtermReminderSyncFingerprint(
        {
          enabled: longtermNotificationSettings.enabled,
          hour: longtermNotificationSettings.hour,
          minute: longtermNotificationSettings.minute,
          deadlineOffsets: longtermNotificationSettings.deadlineOffsets,
          intervalRule: longtermNotificationSettings.intervalRule
        },
        longtermReminderTasksForSchedule
      ),
    [
      longtermNotificationSettings.enabled,
      longtermNotificationSettings.hour,
      longtermNotificationSettings.minute,
      longtermNotificationSettings.deadlineOffsets,
      longtermNotificationSettings.intervalRule,
      longtermReminderTasksForSchedule
    ]
  );
  const reminderSyncFingerprint = useMemo(
    () =>
      buildReminderSyncFingerprint(
        {
          enabled: notificationSettings.enabled,
          periodicHour: notificationSettings.periodicHour,
          periodicMinute: notificationSettings.periodicMinute,
          singleHour: notificationSettings.singleHour,
          singleMinute: notificationSettings.singleMinute,
          mode: notificationSettings.mode,
          dateMode: notificationSettings.dateMode,
          repeatRule: notificationSettings.repeatRule
        },
        reminderTasksForSchedule
      ),
    [
      notificationSettings.enabled,
      notificationSettings.periodicHour,
      notificationSettings.periodicMinute,
      notificationSettings.singleHour,
      notificationSettings.singleMinute,
      notificationSettings.mode,
      notificationSettings.dateMode,
      notificationSettings.repeatRule,
      reminderTasksForSchedule
    ]
  );
  const retentionDays = 120;
  const cutoffDateKey = useMemo(
    () => formatLocalDate(addDays(new Date(), -(retentionDays - 1))),
    [todayKey]
  );
  const selectedTasks = useMemo(() => {
    if (!selectedDateKey) return [];
    const allTasks = [...dailyTasks, ...longtermTasks];
    return allTasks
      .filter((task) => task.earnedPoints !== null)
      .filter((task) => {
        if (typeof task.settledAt === "number") {
          return dateKeyFromTimestamp(task.settledAt) === selectedDateKey;
        }
        if (task.planType === "daily" && task.targetDate === selectedDateKey) {
          return true;
        }
        return false;
      })
      .map((task) => ({
        id: task.id,
        title: task.title,
        earned: task.earnedPoints ?? 0,
        max: task.maxPoints,
        planType: task.planType,
        groupId: task.groupId,
        note: task.note
      }));
  }, [selectedDateKey, dailyTasks, longtermTasks]);

  const selectedTotal = useMemo(
    () => selectedTasks.reduce((sum, item) => sum + item.earned, 0),
    [selectedTasks]
  );

  useEffect(() => {
    if (!isReady) return;
    const cycleDays = Math.max(1, Math.round(Number(archiveSettings.cycleDays || 30)));
    if (!archiveSettings.periodStart) {
      dispatch({ type: "SET_ARCHIVE_CYCLE", cycleDays, periodStart: todayKey });
      return;
    }
    const startDate = parseDateKey(archiveSettings.periodStart);
    if (!startDate) {
      dispatch({ type: "SET_ARCHIVE_CYCLE", cycleDays, periodStart: todayKey });
      return;
    }
    const todayStart = startOfDay(new Date());
    const diffDays = Math.floor((todayStart.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < cycleDays) return;
    const endDate = formatLocalDate(addDays(startDate, cycleDays - 1));
    dispatch({ type: "AUTO_ARCHIVE", cycleDays, nextStart: todayKey, endDate });
  }, [isReady, archiveSettings.cycleDays, archiveSettings.periodStart, todayKey, dispatch]);

  useEffect(() => {
    if (!isReady) return;
    dispatch({ type: "CLEANUP_OLD_RECORDS", cutoffDate: cutoffDateKey });
  }, [isReady, cutoffDateKey, dispatch]);

  useEffect(() => {
    if (!isReady) return;
    syncTaskReminderSchedule(
      {
        enabled: notificationSettings.enabled,
        periodicHour: notificationSettings.periodicHour,
        periodicMinute: notificationSettings.periodicMinute,
        singleHour: notificationSettings.singleHour,
        singleMinute: notificationSettings.singleMinute,
        taskIds: notificationSettings.taskIds,
        mode: notificationSettings.mode,
        dateMode: notificationSettings.dateMode,
        repeatRule: notificationSettings.repeatRule
      },
      reminderTasksForSchedule,
      reminderSyncFingerprint,
      false
    );
  }, [isReady, reminderTasksForSchedule, reminderSyncFingerprint]);

  useEffect(() => {
    if (!isReady) return;
    syncLongtermReminderSchedule(
      {
        enabled: longtermNotificationSettings.enabled,
        hour: longtermNotificationSettings.hour,
        minute: longtermNotificationSettings.minute,
        taskIds: longtermNotificationSettings.taskIds,
        deadlineOffsets: longtermNotificationSettings.deadlineOffsets,
        intervalRule: longtermNotificationSettings.intervalRule
      },
      longtermReminderTasksForSchedule,
      longtermReminderSyncFingerprint,
      false
    );
  }, [isReady, longtermReminderTasksForSchedule, longtermReminderSyncFingerprint]);

  useEffect(() => {
    if (!isReady) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      if (!(prevState.match(/inactive|background/) && nextState === "active")) return;
      const today = formatLocalDate(new Date());
      const dayChanged = lastReminderResyncDateRef.current !== today;
      lastReminderResyncDateRef.current = today;
      syncTaskReminderSchedule(
        {
          enabled: notificationSettings.enabled,
          periodicHour: notificationSettings.periodicHour,
          periodicMinute: notificationSettings.periodicMinute,
          singleHour: notificationSettings.singleHour,
          singleMinute: notificationSettings.singleMinute,
          taskIds: notificationSettings.taskIds,
          mode: notificationSettings.mode,
          dateMode: notificationSettings.dateMode,
          repeatRule: notificationSettings.repeatRule
        },
        reminderTasksForSchedule,
        reminderSyncFingerprint,
        false,
        dayChanged
      );
      syncLongtermReminderSchedule(
        {
          enabled: longtermNotificationSettings.enabled,
          hour: longtermNotificationSettings.hour,
          minute: longtermNotificationSettings.minute,
          taskIds: longtermNotificationSettings.taskIds,
          deadlineOffsets: longtermNotificationSettings.deadlineOffsets,
          intervalRule: longtermNotificationSettings.intervalRule
        },
        longtermReminderTasksForSchedule,
        longtermReminderSyncFingerprint,
        false,
        dayChanged
      );
    });
    return () => {
      subscription.remove();
    };
  }, [
    isReady,
    notificationSettings.enabled,
    notificationSettings.periodicHour,
    notificationSettings.periodicMinute,
    notificationSettings.singleHour,
    notificationSettings.singleMinute,
    notificationSettings.taskIds,
    notificationSettings.mode,
    notificationSettings.dateMode,
    notificationSettings.repeatRule,
    reminderTasksForSchedule,
    reminderSyncFingerprint,
    longtermNotificationSettings.enabled,
    longtermNotificationSettings.hour,
    longtermNotificationSettings.minute,
    longtermNotificationSettings.taskIds,
    longtermNotificationSettings.deadlineOffsets,
    longtermNotificationSettings.intervalRule,
    longtermReminderTasksForSchedule,
    longtermReminderSyncFingerprint
  ]);

  useEffect(() => {
    if (!isReady) return;
    const autoTemplates = state.templates.filter(
      (item) => item.planType === "daily" && item.autoDaily
    );
    if (autoTemplates.length === 0) return;
    const generationTargets = [
      { date: new Date(), targetDate: todayKey },
      { date: addDays(new Date(), 1), targetDate: tomorrowKey }
    ];
    const tasksToAdd: Task[] = [];
    generationTargets.forEach(({ date, targetDate }) => {
      autoTemplates.forEach((template) => {
        if (!isRuleMatch(template.autoRule, date)) return;
        const existsInState = state.tasks.some(
          (task) =>
            task.planType === "daily" &&
            task.targetDate === targetDate &&
            task.groupId === template.groupId &&
            task.title === template.title &&
            task.maxPoints === template.maxPoints
        );
        if (existsInState) return;
        const existsInBatch = tasksToAdd.some(
          (task) =>
            task.targetDate === targetDate &&
            task.groupId === template.groupId &&
            task.title === template.title &&
            task.maxPoints === template.maxPoints
        );
        if (existsInBatch) return;
        tasksToAdd.push({
          id: makeId("task"),
          title: template.title,
          groupId: template.groupId,
          planType: "daily",
          sourceTemplateId: template.id,
          maxPoints: template.maxPoints,
          earnedPoints: null,
          completed: false,
          targetDate,
          createdAt: Date.now()
        });
      });
    });
    if (tasksToAdd.length === 0) return;
    tasksToAdd.forEach((task) => {
      dispatch({ type: "ADD_TASK", task });
    });
  }, [isReady, state.templates, state.tasks, todayKey, tomorrowKey, dispatch]);

  const orderedLongtermTasks = useMemo(() => {
    return [...longtermTasks].sort((a, b) => {
      const aSettled = a.earnedPoints !== null;
      const bSettled = b.earnedPoints !== null;
      if (aSettled !== bSettled) return aSettled ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
  }, [longtermTasks]);

  const templates = useMemo(() => state.templates, [state.templates]);
  const dailyTemplates = useMemo(
    () => templates.filter((item) => item.planType === "daily"),
    [templates]
  );
  const longtermTemplates = useMemo(
    () => templates.filter((item) => item.planType === "longterm"),
    [templates]
  );
  const createTaskTemplates = useMemo(
    () => (newTaskType === "daily" ? dailyTemplates : longtermTemplates),
    [newTaskType, dailyTemplates, longtermTemplates]
  );

  const longtermSettledCount = orderedLongtermTasks.filter((task) => task.earnedPoints !== null).length;
  const [lineChartWidth, setLineChartWidth] = useState(0);

  const gridHeight = useMemo(() => Math.max(SCREEN_HEIGHT, 1400), []);
  const gridWidth = useMemo(() => Math.max(SCREEN_WIDTH, 800), []);
  const horizontalLines = useMemo(
    () => Array.from({ length: Math.ceil(gridHeight / GRID_SPACING) + 1 }),
    [gridHeight]
  );
  const verticalLines = useMemo(
    () => Array.from({ length: Math.ceil(gridWidth / GRID_SPACING) + 1 }),
    [gridWidth]
  );

  const groupMap = useMemo(() => {
    const map = new Map<string, TaskGroup>();
    groups.forEach((group) => map.set(group.id, group));
    return map;
  }, [groups]);

  function getGroupName(groupId: string): string {
    return groupMap.get(groupId)?.name ?? "默认";
  }

  const dailyScoreMap = useMemo(() => {
    const map: Record<string, number> = {};
    const allTasks = [...dailyTasks, ...longtermTasks];
    for (const task of allTasks) {
      if (task.earnedPoints === null) continue;
      let dateKey: string | null = null;
      if (typeof task.settledAt === "number") {
        dateKey = dateKeyFromTimestamp(task.settledAt);
      } else if (task.planType === "daily" && task.targetDate) {
        dateKey = task.targetDate;
      }
      if (!dateKey) continue;
      map[dateKey] = (map[dateKey] ?? 0) + task.earnedPoints;
    }
    return map;
  }, [dailyTasks, longtermTasks]);

  const recentDates = useMemo(() => {
    const list: string[] = [];
    const base = new Date();
    for (let offset = -TREND_DAYS_BEFORE_TODAY; offset <= TREND_DAYS_AFTER_TODAY; offset += 1) {
      list.push(formatLocalDate(addDays(base, offset)));
    }
    return list;
  }, [todayKey]);

  const todayTrendIndex = Math.floor(recentDates.length / 2);

  const recentScores = useMemo(
    () => recentDates.map((dateKey) => dailyScoreMap[dateKey] ?? 0),
    [recentDates, dailyScoreMap]
  );

  const recentMax = Math.max(1, ...recentScores);

  const calendarData = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const cells: Array<{
      key: string;
      dayNumber: number | null;
      dateKey: string | null;
      score: number;
      isCurrentMonth: boolean;
    }> = [];
    for (let i = 0; i < 42; i += 1) {
      const day = i - firstDay + 1;
      if (day < 1 || day > daysInMonth) {
        cells.push({ key: `empty_${i}`, dayNumber: null, dateKey: null, score: 0, isCurrentMonth: false });
      } else {
        const dateKey = formatLocalDate(new Date(year, month, day));
        const score = dailyScoreMap[dateKey] ?? 0;
        cells.push({
          key: dateKey,
          dayNumber: day,
          dateKey,
          score,
          isCurrentMonth: true
        });
      }
    }
    return { cells, monthLabel: `${year}-${String(month + 1).padStart(2, "0")}` };
  }, [dailyScoreMap]);

  function getAutoRuleLabel(rule?: AutoRule): string {
    const target = AUTO_RULE_OPTIONS.find((option) => option.value === rule);
    return target ? target.label : "每日";
  }

  function nextAutoRule(rule?: AutoRule): AutoRule {
    const values = AUTO_RULE_OPTIONS.map((option) => option.value);
    const index = rule ? values.indexOf(rule) : 0;
    const nextIndex = index === -1 ? 0 : (index + 1) % values.length;
    return values[nextIndex];
  }

  function isRuleMatch(rule: AutoRule | undefined, date: Date): boolean {
    const day = date.getDay();
    switch (rule) {
      case "weekday":
        return day >= 1 && day <= 5;
      case "weekend":
        return day === 0 || day === 6;
      case "daily":
      default:
        return true;
    }
  }

  function parsePositiveInt(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    if (rounded <= 0) return null;
    return rounded;
  }

  function parseNonNegativeInt(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    if (rounded < 0) return null;
    return rounded;
  }

  function parseOptionalDateKey(value: string): string {
    const parsed = parseDateKey(value);
    if (!parsed) return "";
    return formatLocalDate(parsed);
  }

  function showShortNotice(message: string) {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    setNoticeText(message);
    noticeAnim.setValue(0);
    Animated.timing(noticeAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true
    }).start();
    noticeTimerRef.current = setTimeout(() => {
      Animated.timing(noticeAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true
      }).start(() => setNoticeText(null));
    }, 1200);
  }

  function scheduleFabDock(delayMs = 2600) {
    if (fabDockTimerRef.current) {
      clearTimeout(fabDockTimerRef.current);
    }
    fabDockTimerRef.current = setTimeout(() => {
      setIsFabDocked(true);
    }, delayMs);
  }

  function openTemplatePicker() {
    if (fabDockTimerRef.current) {
      clearTimeout(fabDockTimerRef.current);
    }
    setIsFabDocked(false);
    setIsTemplatePickerOpen(true);
  }

  function closeTemplatePicker() {
    if (fabDockTimerRef.current) {
      clearTimeout(fabDockTimerRef.current);
    }
    setIsTemplatePickerOpen(false);
    setIsFabDocked(true);
  }

  function handleFabPress() {
    openTemplatePicker();
  }

  function dateFromDateKeyOrToday(dateKey?: string): Date {
    const parsed = typeof dateKey === "string" ? parseDateKey(dateKey) : null;
    return parsed ?? startOfDay(new Date());
  }

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 61 }, (_, idx) => current - 30 + idx);
  }, []);
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, idx) => idx + 1), []);
  const dayOptions = useMemo(() => {
    const daysInMonth = new Date(deadlinePickerYear, deadlinePickerMonth, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, idx) => idx + 1);
  }, [deadlinePickerYear, deadlinePickerMonth]);

  useEffect(() => {
    if (deadlinePickerDay <= dayOptions.length) return;
    setDeadlinePickerDay(dayOptions.length);
  }, [deadlinePickerDay, dayOptions.length]);

  useEffect(() => {
    if (!isDeadlinePickerOpen) return;
    const yearIndex = Math.max(0, yearOptions.indexOf(deadlinePickerYear));
    const monthIndex = Math.max(0, monthOptions.indexOf(deadlinePickerMonth));
    const dayIndex = Math.max(0, dayOptions.indexOf(deadlinePickerDay));
    const timer = setTimeout(() => {
      yearWheelRef.current?.scrollTo({ y: yearIndex * WHEEL_ITEM_HEIGHT, animated: false });
      monthWheelRef.current?.scrollTo({ y: monthIndex * WHEEL_ITEM_HEIGHT, animated: false });
      dayWheelRef.current?.scrollTo({ y: dayIndex * WHEEL_ITEM_HEIGHT, animated: false });
    }, 0);
    return () => clearTimeout(timer);
  }, [
    isDeadlinePickerOpen,
    deadlinePickerYear,
    deadlinePickerMonth,
    deadlinePickerDay,
    yearOptions,
    monthOptions,
    dayOptions
  ]);

  function readWheelIndex(offsetY: number, length: number): number {
    const raw = Math.round(offsetY / WHEEL_ITEM_HEIGHT);
    return Math.max(0, Math.min(length - 1, raw));
  }

  function openCreateDeadlinePicker() {
    const initialDate = dateFromDateKeyOrToday(longtermDeadlineDraft);
    setDeadlinePickerTarget({ kind: "create" });
    setDeadlinePickerYear(initialDate.getFullYear());
    setDeadlinePickerMonth(initialDate.getMonth() + 1);
    setDeadlinePickerDay(initialDate.getDate());
    setIsDeadlinePickerOpen(true);
  }

  function openTaskDeadlinePicker(task: Task) {
    const initialDate = dateFromDateKeyOrToday(task.deadlineDate);
    setDeadlinePickerTarget({ kind: "task", taskId: task.id });
    setDeadlinePickerYear(initialDate.getFullYear());
    setDeadlinePickerMonth(initialDate.getMonth() + 1);
    setDeadlinePickerDay(initialDate.getDate());
    setIsDeadlinePickerOpen(true);
  }

  function closeDeadlinePicker() {
    setIsDeadlinePickerOpen(false);
    setDeadlinePickerTarget(null);
  }

  function applyDeadlinePicker() {
    const dateKey = formatLocalDate(new Date(deadlinePickerYear, deadlinePickerMonth - 1, deadlinePickerDay));
    if (!deadlinePickerTarget) return;
    if (deadlinePickerTarget.kind === "create") {
      setLongtermDeadlineDraft(dateKey);
      showShortNotice("截止日期已设置");
    } else {
      dispatch({
        type: "SET_TASK_DEADLINE",
        taskId: deadlinePickerTarget.taskId,
        deadlineDate: dateKey
      });
      showShortNotice("截止日期已保存");
    }
    closeDeadlinePicker();
  }

  function clearCreateDeadline() {
    setLongtermDeadlineDraft("");
    showShortNotice("已清空截止日期");
  }

  function clearTaskDeadline(task: Task) {
    dispatch({
      type: "SET_TASK_DEADLINE",
      taskId: task.id,
      deadlineDate: undefined
    });
    showShortNotice("已清空截止日期");
  }

  function handleAddTask() {
    const detailNote = taskDetailNote.trim() || undefined;
    const title = taskTitle.trim();
    const points = parsePositiveInt(taskPoints);
    const parsedDeadline = newTaskType === "longterm" ? parseOptionalDateKey(longtermDeadlineDraft) : "";
    if (!title || points === null) {
      Alert.alert("输入有误", "请输入任务名称和大于 0 的最高分");
      return;
    }
    if (!activeGroup) {
      Alert.alert("请先创建任务组", "需要先创建任务组才能添加任务");
      return;
    }
    const task: Task = {
      id: makeId("task"),
      title,
      groupId: activeGroup.id,
      planType: newTaskType,
      sourceTemplateId: createFromTemplateId ?? undefined,
      detailNote,
      maxPoints: points,
      earnedPoints: null,
      completed: false,
      targetDate: newTaskType === "daily" ? dailyTargetKey : undefined,
      deadlineDate: newTaskType === "longterm" && parsedDeadline ? parsedDeadline : undefined,
      createdAt: Date.now()
    };
    dispatch({ type: "ADD_TASK", task });
    setTaskTitle("");
    setTaskPoints("");
    setTaskDetailNote("");
    setLongtermDeadlineDraft("");
    setCreateFromTemplateId(null);
    setIsCreateTemplateDropdownOpen(false);
    setIsTaskModalOpen(false);
  }

  function handlePickCreateTemplate(template: TaskTemplate) {
    setTaskTitle(template.title);
    setTaskPoints(String(template.maxPoints));
    setActiveGroupId(template.groupId);
    setLongtermDeadlineDraft("");
    setCreateFromTemplateId(template.id);
    setIsCreateTemplateDropdownOpen(false);
  }

  function openGroupModal(mode: "create" | "rename") {
    setGroupModalMode(mode);
    if (mode === "rename" && activeGroup) {
      setGroupModalName(activeGroup.name);
      setGroupModalColor(activeGroup.color);
    } else {
      setGroupModalName("");
      setGroupModalColor(GROUP_COLORS[0].value);
    }
    setIsGroupModalOpen(true);
  }

  function handleSubmitGroupModal() {
    const name = groupModalName.trim();
    if (!name) {
      Alert.alert("输入有误", "请输入任务组名称");
      return;
    }
    if (groupModalMode === "create") {
      if (groups.some((group) => group.name === name)) {
        Alert.alert("已存在", "该任务组名称已存在");
        return;
      }
      const group: TaskGroup = {
        id: makeId("group"),
        name,
        color: groupModalColor,
        createdAt: Date.now()
      };
      dispatch({ type: "ADD_GROUP", group });
      setActiveGroupId(group.id);
    } else if (activeGroup) {
      if (groups.some((group) => group.name === name && group.id !== activeGroup.id)) {
        Alert.alert("已存在", "该任务组名称已存在");
        return;
      }
      dispatch({ type: "RENAME_GROUP", groupId: activeGroup.id, name, color: groupModalColor });
    }
    setIsGroupModalOpen(false);
  }

  function openArchiveModal() {
    setArchiveDaysDraft(String(archiveSettings.cycleDays || 30));
    setIsArchiveOpen(true);
  }

  function openReminderModal() {
    setReminderPanel("daily");
    setDailyReminderTaskPage(hasPeriodicReminderTasks ? "periodic" : "single");
    setReminderEnabledDraft(notificationSettings.enabled);
    setPeriodicReminderHourDraft(pad2(notificationSettings.periodicHour));
    setPeriodicReminderMinuteDraft(pad2(notificationSettings.periodicMinute));
    setSingleReminderHourDraft(pad2(notificationSettings.singleHour));
    setSingleReminderMinuteDraft(pad2(notificationSettings.singleMinute));
    setReminderDateModeDraft(notificationSettings.dateMode);
    setReminderTaskIdsDraft(notificationSettings.taskIds.filter((taskId) => dailyTaskIdSet.has(taskId)));
    setLongtermReminderEnabledDraft(longtermNotificationSettings.enabled);
    setLongtermReminderHourDraft(pad2(longtermNotificationSettings.hour));
    setLongtermReminderMinuteDraft(pad2(longtermNotificationSettings.minute));
    setLongtermReminderTaskIdsDraft(
      longtermNotificationSettings.taskIds.filter((taskId) => longtermTaskIdSet.has(taskId))
    );
    setLongtermReminderOffsetsDraft(longtermNotificationSettings.deadlineOffsets);
    setLongtermReminderIntervalDraft(longtermNotificationSettings.intervalRule);
    setIsReminderOpen(true);
  }

  function handleSaveArchiveSettings() {
    const parsed = Number(archiveDaysDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert("输入有误", "请输入有效的周期天数");
      return;
    }
    const cycleDays = Math.max(1, Math.round(parsed));
    dispatch({ type: "SET_ARCHIVE_CYCLE", cycleDays, periodStart: todayKey });
    setIsArchiveOpen(false);
  }

  function handleSavePeriodicReminderSettings() {
    const hourParsed = Number(periodicReminderHourDraft);
    const minuteParsed = Number(periodicReminderMinuteDraft);
    if (
      !Number.isFinite(hourParsed) ||
      !Number.isFinite(minuteParsed) ||
      hourParsed < 0 ||
      hourParsed > 23 ||
      minuteParsed < 0 ||
      minuteParsed > 59
    ) {
      Alert.alert("输入有误", "周期任务提醒时间请输入 00:00 到 23:59");
      return;
    }
    const periodicHour = Math.round(hourParsed);
    const periodicMinute = Math.round(minuteParsed);
    const selectedTaskItems = reminderTaskOptions.filter((task) => reminderTaskIdsDraft.includes(task.id));
    const periodicTaskIds = selectedTaskItems
      .filter((task) => typeof task.autoRule === "string")
      .map((task) => task.id);
    const otherTaskIds = notificationSettings.taskIds.filter((id) => {
      const task = reminderTaskOptions.find((t) => t.id === id);
      return !task || typeof task.autoRule !== "string";
    });
    dispatch({
      type: "SET_NOTIFICATION_SETTINGS",
      enabled: reminderEnabledDraft,
      periodicHour,
      periodicMinute,
      singleHour: notificationSettings.singleHour,
      singleMinute: notificationSettings.singleMinute,
      taskIds: [...periodicTaskIds, ...otherTaskIds],
      mode: hasPeriodicReminderTasks ? "follow_task" : "global_rule",
      dateMode: notificationSettings.dateMode,
      repeatRule: notificationSettings.repeatRule
    });
    showShortNotice(`周期任务提醒已保存 ${pad2(periodicHour)}:${pad2(periodicMinute)}`);
    setIsReminderOpen(false);
  }

  function handleSaveSingleReminderSettings() {
    const hourParsed = Number(singleReminderHourDraft);
    const minuteParsed = Number(singleReminderMinuteDraft);
    if (
      !Number.isFinite(hourParsed) ||
      !Number.isFinite(minuteParsed) ||
      hourParsed < 0 ||
      hourParsed > 23 ||
      minuteParsed < 0 ||
      minuteParsed > 59
    ) {
      Alert.alert("输入有误", "单次任务提醒时间请输入 00:00 到 23:59");
      return;
    }
    const singleHour = Math.round(hourParsed);
    const singleMinute = Math.round(minuteParsed);
    if (buildOnceReminderDate(reminderDateModeDraft, singleHour, singleMinute).getTime() <= Date.now()) {
      Alert.alert("时间已过", "单次提醒请设置为未来时间");
      return;
    }
    const selectedTaskItems = reminderTaskOptions.filter((task) => reminderTaskIdsDraft.includes(task.id));
    const singleTaskIds = selectedTaskItems
      .filter((task) => typeof task.autoRule !== "string")
      .map((task) => task.id);
    const otherTaskIds = notificationSettings.taskIds.filter((id) => {
      const task = reminderTaskOptions.find((t) => t.id === id);
      return !task || typeof task.autoRule === "string";
    });
    dispatch({
      type: "SET_NOTIFICATION_SETTINGS",
      enabled: reminderEnabledDraft,
      periodicHour: notificationSettings.periodicHour,
      periodicMinute: notificationSettings.periodicMinute,
      singleHour,
      singleMinute,
      taskIds: [...singleTaskIds, ...otherTaskIds],
      mode: hasPeriodicReminderTasks ? "follow_task" : "global_rule",
      dateMode: reminderDateModeDraft,
      repeatRule: "once"
    });
    showShortNotice(`单次任务提醒已保存 ${dateModeLabel(reminderDateModeDraft)} ${pad2(singleHour)}:${pad2(singleMinute)}`);
    setIsReminderOpen(false);
  }

  function handleSaveLongtermReminderSettings() {
    const longtermHourParsed = Number(longtermReminderHourDraft);
    const longtermMinuteParsed = Number(longtermReminderMinuteDraft);
    if (
      !Number.isFinite(longtermHourParsed) ||
      !Number.isFinite(longtermMinuteParsed) ||
      longtermHourParsed < 0 ||
      longtermHourParsed > 23 ||
      longtermMinuteParsed < 0 ||
      longtermMinuteParsed > 59
    ) {
      Alert.alert("输入有误", "长期提醒时间请输入 00:00 到 23:59");
      return;
    }
    const longtermSettings = {
      enabled: longtermReminderEnabledDraft,
      hour: Math.round(longtermHourParsed),
      minute: Math.round(longtermMinuteParsed),
      taskIds: longtermReminderTaskIdsDraft.filter((taskId) => longtermReminderTaskOptionIdSet.has(taskId)),
      deadlineOffsets: longtermReminderOffsetsDraft,
      intervalRule: longtermReminderIntervalDraft
    };
    if (longtermSettings.enabled && longtermSettings.taskIds.length === 0) {
      Alert.alert("未设置长期提醒任务", "请至少勾选 1 个带截止日期的长期任务");
      return;
    }
    if (
      longtermSettings.enabled &&
      longtermSettings.deadlineOffsets.length === 0 &&
      longtermSettings.intervalRule === "none"
    ) {
      Alert.alert("未设置提醒规则", "请至少开启一个截止日前提醒或周期提醒");
      return;
    }
    dispatch({
      type: "SET_LONGTERM_NOTIFICATION_SETTINGS",
      enabled: longtermSettings.enabled,
      hour: longtermSettings.hour,
      minute: longtermSettings.minute,
      taskIds: longtermSettings.taskIds,
      deadlineOffsets: longtermSettings.deadlineOffsets,
      intervalRule: longtermSettings.intervalRule
    });
    showShortNotice(`长期提醒已保存 ${pad2(longtermSettings.hour)}:${pad2(longtermSettings.minute)}`);
    setIsReminderOpen(false);
  }

  function toggleLongtermReminderTask(taskId: string) {
    setLongtermReminderTaskIdsDraft((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  }

  function toggleLongtermReminderOffset(offset: number) {
    setLongtermReminderOffsetsDraft((prev) => {
      const exists = prev.includes(offset);
      if (exists) {
        return prev.filter((item) => item !== offset);
      }
      return [...prev, offset].sort((a, b) => b - a);
    });
  }

  function handleDeleteGroup() {
    if (!activeGroup) return;
    if (activeGroup.id === DEFAULT_GROUP_ID) {
      showShortNotice("默认任务组不能删除");
      return;
    }
    setConfirmState({
      title: "删除任务组",
      message: "删除后该组任务与任务库将移动到“默认”任务组",
      action: { type: "deleteGroup", groupId: activeGroup.id }
    });
  }

  function handleSetEarned(task: Task) {
    const rawValue = earnedDrafts[task.id] ?? "";
    const earned = parseNonNegativeInt(rawValue);
    if (earned === null) {
      Alert.alert("输入有误", "请输入 0 到最高分之间的整数");
      return;
    }
    if (earned > task.maxPoints) {
      Alert.alert("超出上限", "实际奖励不能超过最高分");
      return;
    }
    const note = noteDrafts[task.id];
    dispatch({ type: "SET_TASK_EARNED", taskId: task.id, earnedPoints: earned, note });
    setEarnedDrafts((prev) => ({ ...prev, [task.id]: String(earned) }));
    const delta = earned - (task.earnedPoints ?? 0);
    if (delta > 0) {
      setRewardBurst(delta);
      rewardAnim.setValue(0);
      Animated.sequence([
        Animated.timing(rewardAnim, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true
        }),
        Animated.timing(rewardAnim, {
          toValue: 0,
          duration: 520,
          useNativeDriver: true
        })
      ]).start(() => setRewardBurst(null));
    }
  }

  function toggleReminderTask(taskId: string) {
    setReminderTaskIdsDraft((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  }

  function togglePeriodicReminderTemplate(taskIds: string[]) {
    setReminderTaskIdsDraft((prev) => {
      const allSelected = taskIds.every((taskId) => prev.includes(taskId));
      if (allSelected) {
        return prev.filter((taskId) => !taskIds.includes(taskId));
      }
      const merged = new Set([...prev, ...taskIds]);
      return Array.from(merged);
    });
  }

  function isTemplateSaved(task: Task): boolean {
    return templates.some(
      (item) =>
        item.groupId === task.groupId &&
        item.planType === task.planType &&
        item.title === task.title &&
        item.maxPoints === task.maxPoints
    );
  }

  function handleSaveTemplate(task: Task) {
    if (task.sourceTemplateId) {
      Alert.alert("无法保存", "该任务来自任务库，不支持再次保存");
      return;
    }
    if (isTemplateSaved(task)) {
      showShortNotice("该任务已在任务库中，无需重复保存");
      return;
    }
    const template: TaskTemplate = {
      id: makeId("tpl"),
      title: task.title,
      groupId: task.groupId,
      planType: task.planType,
      maxPoints: task.maxPoints,
      createdAt: Date.now()
    };
    dispatch({ type: "ADD_TEMPLATE", template });
    dispatch({ type: "LINK_TASK_TO_TEMPLATE", taskId: task.id, templateId: template.id });
    showShortNotice("已成功保存到任务库");
  }

  function escapeCsvValue(value: string | number): string {
    const raw = String(value ?? "");
    if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
      return `"${raw.replace(/"/g, "\"\"")}"`;
    }
    return raw;
  }

  async function handleExportRecords() {
    if (Platform.OS === "web") {
      Alert.alert("暂不支持", "Web 暂不支持导出，请在手机端操作");
      return;
    }
    const groupMap = new Map(state.groups.map((group) => [group.id, group.name]));
    const rows = state.tasks
      .filter((task) => task.earnedPoints !== null)
      .map((task) => {
        let dateKey: string | null = null;
        if (typeof task.settledAt === "number") {
          dateKey = dateKeyFromTimestamp(task.settledAt);
        } else if (task.planType === "daily" && task.targetDate) {
          dateKey = task.targetDate;
        }
        return {
          dateKey,
          group: groupMap.get(task.groupId) ?? "默认",
          type: task.planType === "daily" ? "每日任务" : "长期任务",
          title: task.title,
          earned: task.earnedPoints ?? 0,
          max: task.maxPoints,
          note: task.note ?? ""
        };
      })
      .filter((row) => row.dateKey && row.dateKey >= cutoffDateKey)
      .sort((a, b) => (a.dateKey ?? "").localeCompare(b.dateKey ?? ""));
    if (rows.length === 0) {
      Alert.alert("暂无记录", "近 120 天无可导出记录");
      return;
    }
    const header = ["日期", "任务组", "类型", "任务", "获得分", "最高分", "备注"];
    const csvLines = [
      header.map(escapeCsvValue).join(","),
      ...rows.map((row) =>
        [
          row.dateKey ?? "",
          row.group,
          row.type,
          row.title,
          row.earned,
          row.max,
          row.note
        ]
          .map(escapeCsvValue)
          .join(",")
      )
    ];
    const csvContent = `\ufeff${csvLines.join("\n")}`;
    try {
      const fileUri = `${FileSystem.documentDirectory}ActionPlus_${todayKey}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8
      });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert("无法分享", "当前设备不支持分享");
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: "text/csv",
        dialogTitle: "导出记录"
      });
    } catch (error) {
      Alert.alert("导出失败", "请稍后重试");
    }
  }

  function openDayDetail(dateKey: string) {
    setSelectedDateKey(dateKey);
    setIsDayDetailOpen(true);
  }

  function closeDayDetail() {
    setIsDayDetailOpen(false);
    setSelectedDateKey(null);
  }

  function closeConfirm() {
    setConfirmState(null);
  }

  function handleConfirmDelete() {
    if (!confirmState) return;
    const action = confirmState.action;
    if (action.type === "deleteGroup") {
      dispatch({ type: "DELETE_GROUP", groupId: action.groupId });
      setActiveGroupId(DEFAULT_GROUP_ID);
    } else if (action.type === "deleteTask") {
      dispatch({ type: "DELETE_TASK", taskId: action.taskId });
    } else if (action.type === "deleteTemplate") {
      dispatch({ type: "DELETE_TEMPLATE", templateId: action.templateId });
    }
    setConfirmState(null);
  }

  const canAddTask = taskTitle.trim().length > 0 && parsePositiveInt(taskPoints) !== null;
  const canSubmitGroupModal = groupModalName.trim().length > 0;
  const taskPointsLabel = "Reward 上限";

  const rewardTranslate = rewardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [12, -8]
  });

  const pressable = (base: any, pressedStyle = styles.pressablePressed) =>
    ({ pressed }: { pressed: boolean }) => [base, pressed && pressedStyle];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.gridOverlay} pointerEvents="none">
        {horizontalLines.map((_, index) => (
          <View
            key={`h_${index}`}
            style={[styles.gridLineHorizontal, { top: index * GRID_SPACING, width: gridWidth }]}
          />
        ))}
        {verticalLines.map((_, index) => (
          <View
            key={`v_${index}`}
            style={[styles.gridLineVertical, { left: index * GRID_SPACING, height: gridHeight }]}
          />
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.profileCard}>
          <View style={styles.paperFoldTop} />
          <View style={styles.paperFoldBottom} />
          <View style={styles.profileLeft}>
            <Text style={styles.profileTitle}>Action+</Text>
          </View>
          <View style={styles.profileRight}>
            <View style={styles.profileRow}>
              <Text style={styles.profileLabel}>当日积分</Text>
              <View style={styles.profileValueRow}>
                <Text style={styles.profileValue}>{todayPoints}</Text>
                <View style={styles.profileActions}>
                  <Pressable onPress={openReminderModal} style={pressable(styles.profileAction)}>
                    <Text style={styles.profileActionText}>提醒</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            <View style={styles.profileRow}>
              <Text style={styles.profileLabel}>累计积分</Text>
              <View style={styles.profileValueRow}>
                <Text style={styles.profileValueDark}>{state.points}</Text>
                <View style={styles.profileActions}>
                  <Pressable onPress={() => setIsHistoryOpen(true)} style={pressable(styles.profileAction)}>
                    <Text style={styles.profileActionText}>历史</Text>
                  </Pressable>
                  <Pressable onPress={openArchiveModal} style={pressable(styles.profileAction)}>
                    <Text style={styles.profileActionText}>周期</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
          {rewardBurst !== null ? (
            <Animated.View
              style={[
                styles.rewardFx,
                {
                  opacity: rewardAnim,
                  transform: [{ translateY: rewardTranslate }],
                  backgroundColor: hexToRgba(activeGroupColor, 0.14),
                  borderColor: hexToRgba(activeGroupColor, 0.5)
                }
              ]}
            >
              <Text style={[styles.rewardFxText, { color: activeGroupColor }]}>{`+${rewardBurst}`}</Text>
              <View style={styles.rewardCoinRow}>
                {[0, 1, 2].map((idx) => (
                  <View
                    key={idx}
                    style={[styles.rewardCoin, { backgroundColor: activeGroupColor, opacity: 0.7 + idx * 0.1 }]}
                  />
                ))}
              </View>
            </Animated.View>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>任务组</Text>
              <Text style={styles.sectionMeta}>{groups.length} 组</Text>
            </View>
            <View style={styles.iconRow}>
              <Pressable style={pressable(styles.iconButton)} onPress={() => openGroupModal("create")}>
                <Text style={styles.iconText}>+</Text>
              </Pressable>
              <Pressable style={pressable(styles.iconButton)} onPress={() => openGroupModal("rename")}>
                <Text style={styles.iconText}>✎</Text>
              </Pressable>
              <Pressable style={pressable([styles.iconButton, styles.iconDanger])} onPress={handleDeleteGroup}>
                <Text style={styles.iconText}>🗑</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupRow}>
            {groups.map((group) => {
              const isActive = group.id === activeGroupId;
              return (
                <Pressable
                  key={group.id}
                  onPress={() => setActiveGroupId(group.id)}
                  style={pressable([
                    styles.groupChip,
                    {
                      borderColor: group.color,
                      backgroundColor: isActive ? hexToRgba(group.color, 0.12) : theme.colors.background
                    }
                  ])}
                >
                  <Text style={[styles.groupChipText, isActive && { color: group.color }]}>
                    {group.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>创建任务</Text>
              {activeGroup ? (
                <View
                  style={[
                    styles.pill,
                    {
                      borderColor: activeGroupColor,
                      backgroundColor: hexToRgba(activeGroupColor, 0.08)
                    }
                  ]}
                >
                  <Text style={[styles.pillText, { color: activeGroupColor }]}>{activeGroup.name}</Text>
                </View>
              ) : null}
            </View>
            <Pressable
              style={pressable(styles.iconButton)}
              onPress={() => {
                setTaskDetailNote("");
                setLongtermDeadlineDraft("");
                setIsCreateTemplateDropdownOpen(false);
                setIsTaskModalOpen(true);
              }}
            >
              <Text style={styles.iconText}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>点击右侧 + 创建新任务</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>任务清单</Text>
            <View style={styles.chartTabs}>
              {[
                { key: "today", label: "今日任务" },
                { key: "tomorrow", label: "明日任务" }
              ].map((item) => {
                const isActive = taskListTab === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setTaskListTab(item.key as "today" | "tomorrow")}
                    style={pressable([styles.chartTab, isActive && styles.chartTabActive])}
                  >
                    <Text style={[styles.chartTabText, isActive && styles.chartTabTextActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.sectionMeta}>
            {taskListTab === "today"
              ? `今日 ${todayTasks.length} 项`
              : `明日 ${tomorrowTasks.length} 项`}
          </Text>
          {todayTasks.length === 0 && tomorrowTasks.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyDesk} />
              <View style={styles.emptyPaper} />
              <View style={styles.emptyPencil}>
                <View style={styles.emptyPencilTip} />
                <View style={styles.emptyPencilBody} />
                <View style={styles.emptyPencilEraser} />
              </View>
              <Text style={styles.emptyText}>暂无任务</Text>
              <Text style={styles.emptySub}>写下一条任务吧</Text>
            </View>
          ) : (
            (taskListTab === "today" ? todayTasks : tomorrowTasks).length === 0 ? (
              <Text style={styles.muted}>
                {taskListTab === "today" ? "今日暂无任务" : "明日暂无任务"}
              </Text>
            ) : (
              (taskListTab === "today" ? todayTasks : tomorrowTasks).map((task) => (
                <View key={task.id} style={styles.taskRow}>
                  <View style={styles.taskMainColumn}>
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    <Text style={styles.taskMeta}>{`最高 ${task.maxPoints} 分 · 任务组 ${getGroupName(task.groupId)}`}</Text>
                    {task.detailNote ? (
                      <View style={styles.noteStrip}>
                        <Text style={styles.noteStripText}>{task.detailNote}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Pressable onPress={() => handleSaveTemplate(task)} style={pressable(styles.linkButton)}>
                    <Text style={styles.linkText}>保存</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setConfirmState({
                        title: "删除任务",
                        message: "确定删除该任务",
                        action: { type: "deleteTask", taskId: task.id }
                      })
                    }
                    style={pressable(styles.linkButton)}
                  >
                    <Text style={styles.linkTextDanger}>删除</Text>
                  </Pressable>
                </View>
              ))
            )
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>每日奖励</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>{todayKey}</Text>
              </View>
            </View>
            <Text style={styles.sectionMeta}>
              {settledCount}/{settlementTasks.length} 已结算
            </Text>
          </View>
          {settlementTasks.length === 0 ? (
            <Text style={styles.muted}>今日暂无待结算任务</Text>
          ) : (
            settlementTasks.map((task) => {
              const draft = earnedDrafts[task.id];
              const value = draft ?? (task.earnedPoints !== null ? String(task.earnedPoints) : "");
              const noteValue = noteDrafts[task.id] ?? task.note ?? "";
              const isExpanded = Boolean(expandedSettleRows[task.id]);
              const statusText =
                task.earnedPoints === null ? "未结算" : `已得 ${task.earnedPoints} 分`;
              const dateHint =
                task.targetDate && task.targetDate !== todayKey ? `计划日 ${task.targetDate}` : "计划日 今日";
              return (
                <View key={task.id} style={styles.settleRow}>
                  <View style={styles.settleHeader}>
                    <View style={styles.taskMainColumn}>
                      <Text style={styles.taskTitle}>{task.title}</Text>
                      <Text style={styles.taskMeta}>{`Reward ${task.maxPoints} 分 · 任务组 ${getGroupName(task.groupId)}`}</Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        setExpandedSettleRows((prev) => ({ ...prev, [task.id]: !Boolean(prev[task.id]) }))
                      }
                      style={pressable(styles.linkButton)}
                    >
                      <Text style={styles.linkText}>{isExpanded ? "收起" : "展开"}</Text>
                    </Pressable>
                  </View>
                  {isExpanded ? (
                    <>
                      <View style={styles.settleMain}>
                        <Text style={styles.taskMeta}>{dateHint}</Text>
                        {task.detailNote ? (
                          <View style={styles.noteStrip}>
                            <Text style={styles.noteStripText}>{task.detailNote}</Text>
                          </View>
                        ) : null}
                        <Text style={styles.statusText}>{statusText}</Text>
                      </View>
                      <View style={styles.settleControls}>
                        <TextInput
                          value={value}
                          onChangeText={(text) =>
                            setEarnedDrafts((prev) => ({ ...prev, [task.id]: text }))
                          }
                          placeholder="实际分"
                          placeholderTextColor={theme.colors.muted}
                          keyboardType="number-pad"
                          style={[styles.input, styles.inputTiny]}
                        />
                        <Pressable
                          onPress={() => handleSetEarned(task)}
                          style={pressable([styles.button, styles.buttonTiny])}
                        >
                          <Text style={styles.buttonText}>确认</Text>
                        </Pressable>
                      </View>
                      <TextInput
                        value={noteValue}
                        onChangeText={(text) => setNoteDrafts((prev) => ({ ...prev, [task.id]: text }))}
                        placeholder="备注"
                        placeholderTextColor={theme.colors.muted}
                        style={[styles.input, styles.inputNote]}
                      />
                    </>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>长期任务</Text>
            <Text style={styles.sectionMeta}>
              {longtermSettledCount}/{orderedLongtermTasks.length} 已结算
            </Text>
          </View>
          {orderedLongtermTasks.length === 0 ? (
            <Text style={styles.muted}>暂无任务</Text>
          ) : (
            orderedLongtermTasks.map((task) => {
              const draft = earnedDrafts[task.id];
              const value = draft ?? (task.earnedPoints !== null ? String(task.earnedPoints) : "");
              const noteValue = noteDrafts[task.id] ?? task.note ?? "";
              const isExpanded = Boolean(expandedSettleRows[task.id]);
              const statusText = task.earnedPoints === null ? "未结算" : `已得 ${task.earnedPoints} 分`;
              return (
                <View key={task.id} style={styles.settleRow}>
                  <View style={styles.settleHeader}>
                    <View style={styles.taskMainColumn}>
                      <Text style={styles.taskTitle}>{task.title}</Text>
                      <Text style={styles.taskMeta}>{`Reward ${task.maxPoints} 分 · 任务组 ${getGroupName(task.groupId)}`}</Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        setExpandedSettleRows((prev) => ({ ...prev, [task.id]: !Boolean(prev[task.id]) }))
                      }
                      style={pressable(styles.linkButton)}
                    >
                      <Text style={styles.linkText}>{isExpanded ? "收起" : "展开"}</Text>
                    </Pressable>
                  </View>
                  {isExpanded ? (
                    <>
                      <View style={styles.settleMain}>
                        <Text style={styles.taskMeta}>{`截止日期 ${task.deadlineDate ?? "未设置"}`}</Text>
                        {task.detailNote ? (
                          <View style={styles.noteStrip}>
                            <Text style={styles.noteStripText}>{task.detailNote}</Text>
                          </View>
                        ) : null}
                        <Text style={styles.statusText}>{statusText}</Text>
                      </View>
                      <View style={styles.deadlineRow}>
                        <Pressable
                          onPress={() => openTaskDeadlinePicker(task)}
                          style={pressable([styles.typeChip, styles.deadlineChip])}
                        >
                          <Text style={styles.typeChipText}>选择截止日期</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => clearTaskDeadline(task)}
                          style={pressable([styles.typeChip, styles.deadlineChip])}
                        >
                          <Text style={styles.typeChipText}>清空</Text>
                        </Pressable>
                      </View>
                      <View style={styles.settleControls}>
                        <TextInput
                          value={value}
                          onChangeText={(text) => setEarnedDrafts((prev) => ({ ...prev, [task.id]: text }))}
                          placeholder="实际分"
                          placeholderTextColor={theme.colors.muted}
                          keyboardType="number-pad"
                          style={[styles.input, styles.inputTiny]}
                        />
                        <Pressable
                          onPress={() => handleSetEarned(task)}
                          style={pressable([styles.button, styles.buttonTiny])}
                        >
                          <Text style={styles.buttonText}>确认</Text>
                        </Pressable>
                        <Pressable onPress={() => handleSaveTemplate(task)} style={pressable(styles.linkButton)}>
                          <Text style={styles.linkText}>保存</Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            setConfirmState({
                              title: "删除任务",
                              message: "确定删除该任务",
                              action: { type: "deleteTask", taskId: task.id }
                            })
                          }
                          style={pressable(styles.linkButton)}
                        >
                          <Text style={styles.linkTextDanger}>删除</Text>
                        </Pressable>
                      </View>
                      <TextInput
                        value={noteValue}
                        onChangeText={(text) => setNoteDrafts((prev) => ({ ...prev, [task.id]: text }))}
                        placeholder="备注"
                        placeholderTextColor={theme.colors.muted}
                        style={[styles.input, styles.inputNote]}
                      />
                    </>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>图表</Text>
            <View style={styles.chartTabs}>
              {["line", "calendar"].map((key) => {
                const isActive = activeChart === key;
                const label = key === "line" ? "趋势图" : "日历图";
                return (
                  <Pressable
                    key={key}
                    onPress={() => setActiveChart(key as "line" | "calendar")}
                    style={pressable([styles.chartTab, isActive && styles.chartTabActive])}
                  >
                    <Text style={[styles.chartTabText, isActive && styles.chartTabTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {activeChart === "line" ? (
            <>
              <Text style={styles.sectionMeta}>{`今日 ${recentScores[todayTrendIndex] ?? 0} 分`}</Text>
              <View
                style={styles.lineChart}
                onLayout={(event) => setLineChartWidth(event.nativeEvent.layout.width)}
              >
                {lineChartWidth > 0 && recentScores.length > 1 ? (
                  <>
                    {recentScores.map((value, index) => {
                      if (index === recentScores.length - 1) return null;
                      const chartPadding = 12;
                      const chartHeight = 120;
                      const usableHeight = chartHeight - chartPadding * 2;
                      const usableWidth = lineChartWidth - chartPadding * 2;
                      const x1 = chartPadding + (usableWidth * index) / (recentScores.length - 1);
                      const x2 = chartPadding + (usableWidth * (index + 1)) / (recentScores.length - 1);
                      const y1 = chartPadding + (1 - value / recentMax) * usableHeight;
                      const y2 = chartPadding + (1 - recentScores[index + 1] / recentMax) * usableHeight;
                      const dx = x2 - x1;
                      const dy = y2 - y1;
                      const length = Math.sqrt(dx * dx + dy * dy);
                      const angleRad = Math.atan2(dy, dx);
                      const angle = (angleRad * 180) / Math.PI;
                      const adjustedLeft = x1 + (length / 2) * (Math.cos(angleRad) - 1);
                      const adjustedTop = y1 + (length / 2) * Math.sin(angleRad);
                      return (
                        <View
                          key={`line_${index}`}
                          style={[
                            styles.lineSegment,
                            {
                              width: length,
                              left: adjustedLeft,
                              top: adjustedTop,
                              transform: [{ rotate: `${angle}deg` }],
                              backgroundColor: activeGroupColor
                            }
                          ]}
                        />
                      );
                    })}
                    {recentScores.map((value, index) => {
                      const chartPadding = 12;
                      const chartHeight = 120;
                      const usableHeight = chartHeight - chartPadding * 2;
                      const usableWidth = lineChartWidth - chartPadding * 2;
                      const x = chartPadding + (usableWidth * index) / (recentScores.length - 1);
                      const y = chartPadding + (1 - value / recentMax) * usableHeight;
                      const dateKey = recentDates[index];
                      const isTodayPoint = index === todayTrendIndex;
                      const pointSize = isTodayPoint ? 12 : 8;
                      return (
                        <Pressable
                          key={`point_${index}`}
                          onPress={() => openDayDetail(dateKey)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={pressable([
                            styles.linePoint,
                            isTodayPoint && styles.linePointToday,
                            {
                              left: x - pointSize / 2,
                              top: y - pointSize / 2,
                              backgroundColor: activeGroupColor
                            }
                          ])}
                        />
                      );
                    })}
                  </>
                ) : (
                  <Text style={styles.muted}>暂无趋势数据</Text>
                )}
              </View>
              <View style={styles.chartAxis}>
                <Text style={styles.axisLabel}>{recentDates[0]}</Text>
                <Text style={styles.axisLabel}>{recentDates[recentDates.length - 1]}</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sectionMeta}>{calendarData.monthLabel}</Text>
              <View style={styles.weekRow}>
                {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
                  <Text key={label} style={styles.weekLabel}>
                    {label}
                  </Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {calendarData.cells.map((cell) => {
                  if (!cell.isCurrentMonth || cell.dayNumber === null) {
                    return <View key={cell.key} style={styles.calendarCell} />;
                  }
                  const normalizedScore = Math.max(0, Math.min(1, cell.score / 20));
                  const intensity = cell.score <= 0 ? 0 : 0.2 + 0.8 * Math.pow(normalizedScore, 0.85);
                  const heatColor =
                    intensity === 0
                      ? theme.colors.background
                      : hexToRgba(CALENDAR_HEAT_BASE_COLOR, 0.16 + intensity * 0.82);
                  const textColor = intensity >= 0.6 ? "#FFFFFF" : theme.colors.text;
                  return (
                    <Pressable
                      key={cell.key}
                      style={pressable(styles.calendarCell)}
                      onPress={() => openDayDetail(cell.dateKey ?? todayKey)}
                    >
                      <View
                        style={[
                          styles.dayCircle,
                          {
                            backgroundColor: heatColor,
                            borderColor:
                              intensity === 0
                                ? theme.colors.border
                                : hexToRgba(CALENDAR_HEAT_BASE_COLOR, 0.45 + intensity * 0.4)
                          }
                        ]}
                      >
                        <Text style={[styles.dayText, { color: textColor }]}>{cell.dayNumber}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </View>

      </ScrollView>

      <Animated.View
        style={[
          styles.fabWrap,
          {
            opacity: fabDockAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.94, 0.66]
            }),
            transform: [
              {
                translateX: fabDockAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 28]
                })
              }
            ]
          }
        ]}
      >
        <Pressable
          style={pressable([styles.fab, isFabDocked && styles.fabDocked])}
          onPress={handleFabPress}
          accessibilityLabel="打开任务库"
        >
          <View style={styles.fabIconStack}>
            <View style={[styles.fabIconCard, styles.fabIconCardBack]} />
            <View style={styles.fabIconCard} />
          </View>
        </Pressable>
      </Animated.View>

      {noticeText ? (
        <Animated.View
          style={[
            styles.noticeToast,
            {
              opacity: noticeAnim,
              transform: [
                {
                  translateY: noticeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0]
                  })
                }
              ]
            }
          ]}
        >
          <Text style={styles.noticeToastText}>{noticeText}</Text>
        </Animated.View>
      ) : null}

      <Modal visible={isTemplatePickerOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPress} onPress={closeTemplatePicker} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>任务库</Text>
              <Pressable onPress={closeTemplatePicker} style={pressable(styles.linkButton)}>
                <Text style={styles.linkText}>关闭</Text>
              </Pressable>
            </View>
            <View style={styles.typeRow}>
              {TASK_TYPE_OPTIONS.map((type) => {
                const isActive = templateTab === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => setTemplateTab(type)}
                    style={pressable([styles.typeChip, isActive && styles.typeChipActive])}
                  >
                    <Text style={[styles.typeChipText, isActive && styles.typeChipTextActive]}>
                      {TASK_TYPE_LABELS[type]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <ScrollView>
              {templateTab === "daily" ? (
                dailyTemplates.length === 0 ? (
                  <Text style={styles.muted}>暂无任务库内容</Text>
                ) : (
                  dailyTemplates.map((template) => (
                    <View key={template.id} style={styles.taskRow}>
                      <View style={styles.taskMainColumn}>
                        <Text style={styles.taskTitle}>{template.title}</Text>
                        <Text
                          style={styles.taskMeta}
                        >{`最高 ${template.maxPoints} 分 · 任务组 ${getGroupName(template.groupId)}`}</Text>
                      </View>
                      <Pressable
                        onPress={() =>
                          dispatch({
                            type: "TOGGLE_TEMPLATE_AUTO",
                            templateId: template.id,
                            enabled: !template.autoDaily
                          })
                        }
                        style={pressable([styles.autoIconButton, template.autoDaily && styles.autoIconButtonActive])}
                      >
                        <Text style={[styles.autoIconText, template.autoDaily && styles.autoIconTextActive]}>
                          ⚡
                        </Text>
                      </Pressable>
                      {template.autoDaily ? (
                        <Pressable
                          onPress={() =>
                            dispatch({
                              type: "SET_TEMPLATE_AUTO_RULE",
                              templateId: template.id,
                              rule: nextAutoRule(template.autoRule)
                            })
                          }
                          style={pressable(styles.ruleChip)}
                        >
                          <Text style={styles.ruleChipText}>{getAutoRuleLabel(template.autoRule)}</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() =>
                          setConfirmState({
                            title: "删除模板",
                            message: "确定删除该模板",
                            action: { type: "deleteTemplate", templateId: template.id }
                          })
                        }
                        style={pressable(styles.actionIconButton)}
                        accessibilityLabel="删除"
                      >
                        <Text style={[styles.actionIconText, styles.actionIconDanger]}>🗑</Text>
                      </Pressable>
                    </View>
                  ))
                )
              ) : longtermTemplates.length === 0 ? (
                <Text style={styles.muted}>暂无任务库内容</Text>
              ) : (
                longtermTemplates.map((template) => (
                  <View key={template.id} style={styles.taskRow}>
                    <View style={styles.taskMainColumn}>
                      <Text style={styles.taskTitle}>{template.title}</Text>
                      <Text
                        style={styles.taskMeta}
                      >{`最高 ${template.maxPoints} 分 · 任务组 ${getGroupName(template.groupId)}`}</Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        setConfirmState({
                          title: "删除模板",
                          message: "确定删除该模板",
                          action: { type: "deleteTemplate", templateId: template.id }
                        })
                      }
                      style={pressable(styles.actionIconButton)}
                      accessibilityLabel="删除"
                    >
                      <Text style={[styles.actionIconText, styles.actionIconDanger]}>🗑</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={isGroupModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setIsGroupModalOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>
                {groupModalMode === "create" ? "新建任务组" : "重命名任务组"}
              </Text>
              <Pressable onPress={() => setIsGroupModalOpen(false)} style={pressable(styles.linkButton)}>
                <Text style={styles.linkText}>关闭</Text>
              </Pressable>
            </View>
            <TextInput
              value={groupModalName}
              onChangeText={setGroupModalName}
              placeholder="任务组名称"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
            />
            <Text style={styles.sectionMeta}>主题色</Text>
            <View style={styles.colorRow}>
              {GROUP_COLORS.map((item) => {
                const isActive = groupModalColor === item.value;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setGroupModalColor(item.value)}
                    style={pressable([
                      styles.colorDot,
                      { backgroundColor: item.value },
                      isActive && styles.colorDotActive
                    ])}
                  />
                );
              })}
            </View>
            <Pressable
              onPress={handleSubmitGroupModal}
              disabled={!canSubmitGroupModal}
              style={pressable([styles.button, !canSubmitGroupModal && styles.buttonDisabled])}
            >
              <Text style={styles.buttonText}>{groupModalMode === "create" ? "创建" : "保存"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={isArchiveOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setIsArchiveOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>自动保存周期</Text>
              <Pressable onPress={() => setIsArchiveOpen(false)} style={pressable(styles.linkButton)}>
                <Text style={styles.linkText}>关闭</Text>
              </Pressable>
            </View>
            <TextInput
              value={archiveDaysDraft}
              onChangeText={setArchiveDaysDraft}
              placeholder="周期天数"
              placeholderTextColor={theme.colors.muted}
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={styles.typeRow}>
              {[7, 14, 30].map((days) => {
                const isActive = Number(archiveDaysDraft) === days;
                return (
                  <Pressable
                    key={days}
                    onPress={() => setArchiveDaysDraft(String(days))}
                    style={pressable([styles.typeChip, isActive && styles.typeChipActive])}
                  >
                    <Text style={[styles.typeChipText, isActive && styles.typeChipTextActive]}>
                      {`${days} 天`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={handleSaveArchiveSettings} style={pressable(styles.button)}>
              <Text style={styles.buttonText}>保存设置</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={isReminderOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setIsReminderOpen(false)} />
          <View style={[styles.modalSheet, styles.reminderModalSheet]}>
            <View style={styles.modalHeader}>
              <View style={styles.reminderHeaderMain}>
                <Text style={styles.sectionTitle}>通知设置</Text>
                <View style={styles.chartTabs}>
                  {[
                    { key: "daily", label: "短期" },
                    { key: "longterm", label: "长期" }
                  ].map((item) => {
                    const isActive = reminderPanel === item.key;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => setReminderPanel(item.key as "daily" | "longterm")}
                        style={pressable([styles.chartTab, isActive && styles.chartTabActive])}
                      >
                        <Text style={[styles.chartTabText, isActive && styles.chartTabTextActive]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Pressable onPress={() => setIsReminderOpen(false)} style={pressable(styles.linkButton)}>
                <Text style={styles.linkText}>关闭</Text>
              </Pressable>
            </View>
            {reminderPanel === "daily" ? (
              <>
                <Pressable
                  onPress={() => setReminderEnabledDraft((prev) => !prev)}
                  style={pressable(styles.reminderSwitchRow)}
                >
                  <Text style={styles.reminderSwitchLabel}>短期提醒</Text>
                  <View style={[styles.togglePill, reminderEnabledDraft && styles.togglePillActive]}>
                    <Text style={[styles.togglePillText, reminderEnabledDraft && styles.togglePillTextActive]}>
                      {reminderEnabledDraft ? "开" : "关"}
                    </Text>
                  </View>
                </Pressable>
                <Text style={styles.sectionMeta}>{`当前 ${reminderSummary}`}</Text>
                <View style={[styles.chartTabs, styles.reminderSubTabs]}>
                  {[{ key: "periodic", label: "周期任务" }, { key: "single", label: "单次任务" }].map((item) => {
                    const isActive = dailyReminderTaskPage === item.key;
                    const disabled = item.key === "periodic" && !hasPeriodicReminderTasks;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => {
                          if (disabled) return;
                          setDailyReminderTaskPage(item.key as "periodic" | "single");
                        }}
                        style={pressable([
                          styles.chartTab,
                          isActive && styles.chartTabActive,
                          disabled && styles.sectionDisabled
                        ])}
                      >
                        <Text style={[styles.chartTabText, isActive && styles.chartTabTextActive]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {dailyReminderTaskPage === "periodic" ? (
                  hasPeriodicReminderTasks ? (
                    <Text style={[styles.sectionMeta, !reminderEnabledDraft && styles.muted]}>
                      周期任务将自动跟随任务周期（每日/工作日/周末）
                    </Text>
                  ) : (
                    <View style={[styles.reminderHintPill, !reminderEnabledDraft && styles.sectionDisabled]}>
                      <Text style={styles.reminderHintPillText}>暂无周期任务</Text>
                    </View>
                  )
                ) : (
                  <>
                    <Text style={[styles.sectionMeta, !reminderEnabledDraft && styles.muted]}>单次提醒日期</Text>
                    <View style={[styles.reminderOptionRow, !reminderEnabledDraft && styles.sectionDisabled]}>
                      {REMINDER_DATE_OPTIONS.map((item) => {
                        const isActive = reminderDateModeDraft === item.value;
                        return (
                          <Pressable
                            key={item.value}
                            onPress={() => setReminderDateModeDraft(item.value)}
                            style={pressable([
                              styles.reminderOptionChip,
                              isActive && styles.reminderOptionChipActive
                            ])}
                          >
                            <Text style={[styles.reminderOptionChipText, isActive && styles.reminderOptionChipTextActive]}>
                              {item.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}
                <Text style={[styles.sectionTitle, !reminderEnabledDraft && styles.muted]}>选择任务</Text>
                <ScrollView style={[styles.reminderList, !reminderEnabledDraft && styles.sectionDisabled]}>
                  {dailyReminderTaskPage === "periodic" ? (
                    periodicReminderDisplayOptions.length === 0 ? (
                      <Text style={styles.muted}>暂无周期任务</Text>
                    ) : (
                      periodicReminderDisplayOptions.map((task) => {
                        const checked = task.taskIds.every((taskId) => reminderTaskIdsDraft.includes(taskId));
                        return (
                          <Pressable
                            key={task.key}
                            onPress={() => togglePeriodicReminderTemplate(task.taskIds)}
                            style={pressable([styles.reminderTaskRow, checked && styles.reminderTaskRowActive])}
                          >
                            <View style={[styles.reminderTaskCheck, checked && styles.reminderTaskCheckActive]} />
                            <View style={styles.taskMainColumn}>
                              <Text style={styles.reminderTaskTitle} numberOfLines={2} ellipsizeMode="tail">
                                {task.title}
                              </Text>
                              <Text style={styles.reminderTaskMeta} numberOfLines={1} ellipsizeMode="tail">
                                {`最高 ${task.maxPoints} 分 · 任务组 ${getGroupName(task.groupId)} · 周期 ${getAutoRuleLabel(task.autoRule)} · 已合并`}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })
                    )
                  ) : singleReminderTaskOptions.length === 0 ? (
                    <Text style={styles.muted}>暂无可提醒任务</Text>
                  ) : (
                    singleReminderTaskOptions.map((task) => {
                      const checked = reminderTaskIdsDraft.includes(task.id);
                      return (
                        <Pressable
                          key={task.id}
                          onPress={() => toggleReminderTask(task.id)}
                          style={pressable([styles.reminderTaskRow, checked && styles.reminderTaskRowActive])}
                        >
                          <View style={[styles.reminderTaskCheck, checked && styles.reminderTaskCheckActive]} />
                          <View style={styles.taskMainColumn}>
                            <Text style={styles.reminderTaskTitle} numberOfLines={2} ellipsizeMode="tail">
                              {task.title}
                            </Text>
                            <Text style={styles.reminderTaskMeta} numberOfLines={1} ellipsizeMode="tail">
                              {`最高 ${task.maxPoints} 分 · 任务组 ${getGroupName(task.groupId)} · 目标日 ${task.targetDate === todayKey
                                ? "今天"
                                : task.targetDate === tomorrowKey
                                  ? "明天"
                                  : task.targetDate || "未设置"
                                }`}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>

                {dailyReminderTaskPage === "periodic" ? (
                  <>
                    <Text style={[styles.sectionMeta, !reminderEnabledDraft && styles.muted]}>周期任务提醒时间</Text>
                    <View style={[styles.reminderTimeRow, !reminderEnabledDraft && styles.sectionDisabled]}>
                      <TextInput
                        value={periodicReminderHourDraft}
                        onChangeText={setPeriodicReminderHourDraft}
                        placeholder="时"
                        placeholderTextColor={theme.colors.muted}
                        keyboardType="number-pad"
                        style={[styles.input, styles.inputSmall]}
                      />
                      <Text style={styles.sectionTitle}>:</Text>
                      <TextInput
                        value={periodicReminderMinuteDraft}
                        onChangeText={setPeriodicReminderMinuteDraft}
                        placeholder="分"
                        placeholderTextColor={theme.colors.muted}
                        keyboardType="number-pad"
                        style={[styles.input, styles.inputSmall]}
                      />
                    </View>
                    <View style={styles.reminderTestRow}>
                      <Pressable
                        onPress={() => handleTestReminderNotification("periodic")}
                        style={pressable([styles.reminderTestButton])}
                      >
                        <Text style={styles.reminderTestButtonText}>测试周期任务</Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={handleSavePeriodicReminderSettings} style={pressable(styles.button)}>
                      <Text style={styles.buttonText}>保存周期设置</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={[styles.sectionMeta, !reminderEnabledDraft && styles.muted]}>单次任务提醒时间</Text>
                    <View style={[styles.reminderTimeRow, !reminderEnabledDraft && styles.sectionDisabled]}>
                      <TextInput
                        value={singleReminderHourDraft}
                        onChangeText={setSingleReminderHourDraft}
                        placeholder="时"
                        placeholderTextColor={theme.colors.muted}
                        keyboardType="number-pad"
                        style={[styles.input, styles.inputSmall]}
                      />
                      <Text style={styles.sectionTitle}>:</Text>
                      <TextInput
                        value={singleReminderMinuteDraft}
                        onChangeText={setSingleReminderMinuteDraft}
                        placeholder="分"
                        placeholderTextColor={theme.colors.muted}
                        keyboardType="number-pad"
                        style={[styles.input, styles.inputSmall]}
                      />
                    </View>
                    <View style={styles.reminderTestRow}>
                      <Pressable
                        onPress={() => handleTestReminderNotification("single")}
                        style={pressable([styles.reminderTestButton])}
                      >
                        <Text style={styles.reminderTestButtonText}>测试单次任务</Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={handleSaveSingleReminderSettings} style={pressable(styles.button)}>
                      <Text style={styles.buttonText}>保存单次设置</Text>
                    </Pressable>
                  </>
                )}
              </>
            ) : (
              <>
                <Pressable
                  onPress={() => setLongtermReminderEnabledDraft((prev) => !prev)}
                  style={pressable(styles.reminderSwitchRow)}
                >
                  <Text style={styles.reminderSwitchLabel}>长期提醒</Text>
                  <View style={[styles.togglePill, longtermReminderEnabledDraft && styles.togglePillActive]}>
                    <Text style={[styles.togglePillText, longtermReminderEnabledDraft && styles.togglePillTextActive]}>
                      {longtermReminderEnabledDraft ? "开" : "关"}
                    </Text>
                  </View>
                </Pressable>
                <Text style={styles.sectionMeta}>{`当前 ${longtermReminderSummary}`}</Text>
                <Text style={[styles.sectionMeta, !longtermReminderEnabledDraft && styles.muted]}>长期提醒时间</Text>
                <View style={[styles.reminderTimeRow, !longtermReminderEnabledDraft && styles.sectionDisabled]}>
                  <TextInput
                    value={longtermReminderHourDraft}
                    onChangeText={setLongtermReminderHourDraft}
                    placeholder="时"
                    placeholderTextColor={theme.colors.muted}
                    keyboardType="number-pad"
                    style={[styles.input, styles.inputSmall]}
                  />
                  <Text style={styles.sectionTitle}>:</Text>
                  <TextInput
                    value={longtermReminderMinuteDraft}
                    onChangeText={setLongtermReminderMinuteDraft}
                    placeholder="分"
                    placeholderTextColor={theme.colors.muted}
                    keyboardType="number-pad"
                    style={[styles.input, styles.inputSmall]}
                  />
                </View>
                <Text style={[styles.sectionTitle, !longtermReminderEnabledDraft && styles.muted]}>截止日前提醒</Text>
                <View style={[styles.reminderOptionRow, !longtermReminderEnabledDraft && styles.sectionDisabled]}>
                  {LONGTERM_DEADLINE_OFFSET_OPTIONS.map((item) => {
                    const isActive = longtermReminderOffsetsDraft.includes(item.value);
                    return (
                      <Pressable
                        key={item.value}
                        onPress={() => toggleLongtermReminderOffset(item.value)}
                        style={pressable([
                          styles.reminderOptionChip,
                          isActive && styles.reminderOptionChipActive
                        ])}
                      >
                        <Text style={[styles.reminderOptionChipText, isActive && styles.reminderOptionChipTextActive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.sectionTitle, !longtermReminderEnabledDraft && styles.muted]}>周期跟进提醒</Text>
                <View style={[styles.reminderOptionRow, !longtermReminderEnabledDraft && styles.sectionDisabled]}>
                  {LONGTERM_INTERVAL_OPTIONS.map((item) => {
                    const isActive = longtermReminderIntervalDraft === item.value;
                    return (
                      <Pressable
                        key={item.value}
                        onPress={() => setLongtermReminderIntervalDraft(item.value)}
                        style={pressable([
                          styles.reminderOptionChip,
                          isActive && styles.reminderOptionChipActive
                        ])}
                      >
                        <Text style={[styles.reminderOptionChipText, isActive && styles.reminderOptionChipTextActive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.sectionTitle, !longtermReminderEnabledDraft && styles.muted]}>选择长期任务</Text>
                <ScrollView style={[styles.reminderList, !longtermReminderEnabledDraft && styles.sectionDisabled]}>
                  {longtermReminderTaskOptions.length === 0 ? (
                    <Text style={styles.muted}>暂无可提醒的长期任务（请先设置截止日期）</Text>
                  ) : (
                    longtermReminderTaskOptions.map((task) => {
                      const checked = longtermReminderTaskIdsDraft.includes(task.id);
                      return (
                        <Pressable
                          key={task.id}
                          onPress={() => toggleLongtermReminderTask(task.id)}
                          style={pressable([styles.reminderTaskRow, checked && styles.reminderTaskRowActive])}
                        >
                          <View style={[styles.reminderTaskCheck, checked && styles.reminderTaskCheckActive]} />
                          <View style={styles.taskMainColumn}>
                            <Text style={styles.reminderTaskTitle} numberOfLines={2} ellipsizeMode="tail">
                              {task.title}
                            </Text>
                            <Text style={styles.reminderTaskMeta} numberOfLines={1} ellipsizeMode="tail">
                              {`任务组 ${getGroupName(task.groupId)} · 截止日 ${task.deadlineDate}`}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
                <Pressable onPress={handleSaveLongtermReminderSettings} style={pressable(styles.button)}>
                  <Text style={styles.buttonText}>保存长期设置</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={isHistoryOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setIsHistoryOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>积分历史</Text>
              <View style={styles.modalActions}>
                <Pressable onPress={handleExportRecords} style={pressable(styles.modalAction)}>
                  <Text style={styles.modalActionText}>导出</Text>
                </Pressable>
                <Pressable onPress={() => setIsHistoryOpen(false)} style={pressable(styles.modalAction)}>
                  <Text style={styles.modalActionText}>关闭</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView>
              {archives.length === 0 ? (
                <Text style={styles.muted}>暂无历史记录</Text>
              ) : (
                archives.map((item) => (
                  <View key={item.id} style={styles.historyRow}>
                    <Text style={styles.taskTitle}>{item.endDate}</Text>
                    <Text style={styles.historyValue}>{item.totalPoints} 分</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(confirmState)} transparent animationType="fade">
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.sectionTitle}>{confirmState?.title ?? ""}</Text>
            <Text style={styles.confirmText}>{confirmState?.message ?? ""}</Text>
            <View style={styles.confirmActions}>
              <Pressable onPress={closeConfirm} style={pressable(styles.confirmGhost)}>
                <Text style={styles.confirmGhostText}>取消</Text>
              </Pressable>
              <Pressable onPress={handleConfirmDelete} style={pressable(styles.confirmDanger)}>
                <Text style={styles.confirmDangerText}>删除</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isDayDetailOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPress} onPress={closeDayDetail} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>当日记录</Text>
              <Pressable onPress={closeDayDetail} style={pressable(styles.linkButton)}>
                <Text style={styles.linkText}>关闭</Text>
              </Pressable>
            </View>
            {selectedDateKey ? (
              <View style={styles.pillInline}>
                <Text style={styles.pillText}>{selectedDateKey}</Text>
              </View>
            ) : null}
            <View style={styles.detailSummary}>
              <Text style={styles.sectionMeta}>合计</Text>
              <Text style={styles.historyValue}>{selectedTotal} 分</Text>
            </View>
            <ScrollView>
              {selectedTasks.length === 0 ? (
                <Text style={styles.muted}>当天暂无已结算任务</Text>
              ) : (
                selectedTasks.map((item) => (
                  <View key={item.id} style={styles.detailCard}>
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailTitle}>{item.title}</Text>
                      <Text style={styles.detailBadge}>{item.earned} 分</Text>
                    </View>
                    <Text style={styles.detailMeta}>
                      {item.planType === "daily" ? "每日任务" : "长期任务"} · 最高 {item.max} 分 · 任务组 {getGroupName(item.groupId)}
                    </Text>
                    {item.note ? <Text style={styles.detailNote}>{item.note}</Text> : null}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={isTaskModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalBackdropPress}
            onPress={() => {
              setTaskDetailNote("");
              setLongtermDeadlineDraft("");
              setIsCreateTemplateDropdownOpen(false);
              setIsTaskModalOpen(false);
            }}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={styles.titleRow}>
                <Text style={styles.sectionTitle}>新建任务</Text>
                {activeGroup ? (
                  <View
                    style={[
                      styles.pill,
                      {
                        borderColor: activeGroupColor,
                        backgroundColor: hexToRgba(activeGroupColor, 0.08)
                      }
                    ]}
                  >
                    <Text style={[styles.pillText, { color: activeGroupColor }]}>{activeGroup.name}</Text>
                  </View>
                ) : null}
              </View>
              <Pressable
                onPress={() => {
                  setTaskDetailNote("");
                  setLongtermDeadlineDraft("");
                  setIsCreateTemplateDropdownOpen(false);
                  setIsTaskModalOpen(false);
                }}
                style={pressable(styles.linkButton)}
              >
                <Text style={styles.linkText}>关闭</Text>
              </Pressable>
            </View>
            <View style={styles.typeRow}>
              {TASK_TYPE_OPTIONS.map((type) => {
                const isActive = newTaskType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => {
                      setNewTaskType(type);
                      if (type === "daily") {
                        setDailyTargetKey(tomorrowKey);
                        setLongtermDeadlineDraft("");
                      }
                    }}
                    style={pressable([styles.typeChip, isActive && styles.typeChipActive])}
                  >
                    <Text style={[styles.typeChipText, isActive && styles.typeChipTextActive]}>
                      {TASK_TYPE_LABELS[type]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.taskNameRow}>
              <TextInput
                value={taskTitle}
                onChangeText={setTaskTitle}
                placeholder="任务名称"
                placeholderTextColor={theme.colors.muted}
                style={[styles.input, styles.inputFlex]}
              />
              <Pressable
                onPress={() => setIsCreateTemplateDropdownOpen((prev) => !prev)}
                style={pressable(styles.templatePickButton)}
              >
                <Text style={styles.templatePickIcon}>≡</Text>
              </Pressable>
            </View>
            <Modal visible={isCreateTemplateDropdownOpen} transparent animationType="fade">
              <View style={styles.dropdownModalBackdrop}>
                <Pressable
                  style={styles.modalBackdropPress}
                  onPress={() => setIsCreateTemplateDropdownOpen(false)}
                />
                <View style={styles.dropdownModalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.sectionTitle}>选择任务库模板</Text>
                    <Pressable
                      onPress={() => setIsCreateTemplateDropdownOpen(false)}
                      style={pressable(styles.linkButton)}
                    >
                      <Text style={styles.linkText}>关闭</Text>
                    </Pressable>
                  </View>
                  <ScrollView nestedScrollEnabled style={styles.dropdownScroll}>
                    {createTaskTemplates.length === 0 ? (
                      <Text style={styles.muted}>当前类型暂无任务库内容</Text>
                    ) : (
                      createTaskTemplates.map((template) => (
                        <Pressable
                          key={template.id}
                          onPress={() => handlePickCreateTemplate(template)}
                          style={pressable(styles.dropdownItem)}
                        >
                          <Text style={styles.taskTitle}>{template.title}</Text>
                          <Text style={styles.taskMeta}>{`最高 ${template.maxPoints} 分 · 任务组 ${getGroupName(template.groupId)}`}</Text>
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>
              </View>
            </Modal>
            <TextInput
              value={taskDetailNote}
              onChangeText={setTaskDetailNote}
              placeholder="任务便签（可选，用于记录细节）"
              placeholderTextColor={theme.colors.muted}
              multiline
              style={[styles.input, styles.inputNoteDraft]}
            />
            {newTaskType === "daily" ? (
              <>
                <View style={styles.typeRow}>
                  {[
                    { key: todayKey, label: "今天" },
                    { key: tomorrowKey, label: "明天" }
                  ].map((item) => {
                    const isActive = dailyTargetKey === item.key;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => setDailyTargetKey(item.key)}
                        style={pressable([styles.typeChip, isActive && styles.typeChipActive])}
                      >
                        <Text style={[styles.typeChipText, isActive && styles.typeChipTextActive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.pillInline}>
                  <Text style={styles.pillText}>{`目标日 ${dailyTargetKey}`}</Text>
                </View>
              </>
            ) : null}
            {newTaskType === "longterm" ? (
              <View style={styles.deadlineCreateRow}>
                <View style={styles.pillInline}>
                  <Text style={styles.pillText}>{`截止日期 ${longtermDeadlineDraft || "未设置"}`}</Text>
                </View>
                <View style={styles.deadlineRow}>
                  <Pressable
                    onPress={openCreateDeadlinePicker}
                    style={pressable([styles.typeChip, styles.deadlineChip])}
                  >
                    <Text style={styles.typeChipText}>选择日期</Text>
                  </Pressable>
                  <Pressable
                    onPress={clearCreateDeadline}
                    style={pressable([styles.typeChip, styles.deadlineChip])}
                  >
                    <Text style={styles.typeChipText}>清空</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <View style={styles.row}>
              <TextInput
                value={taskPoints}
                onChangeText={setTaskPoints}
                placeholder={taskPointsLabel}
                placeholderTextColor={theme.colors.muted}
                keyboardType="number-pad"
                style={[styles.input, styles.inputSmall]}
              />
              <Pressable
                onPress={handleAddTask}
                disabled={!canAddTask}
                style={pressable([styles.button, !canAddTask && styles.buttonDisabled])}
              >
                <Text style={styles.buttonText}>创建</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isDeadlinePickerOpen} transparent animationType="fade">
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.sectionTitle}>选择截止日期</Text>
            <View style={styles.deadlineWheelWrap}>
              <View style={styles.deadlineWheelMask} />
              <View style={styles.deadlineWheelRow}>
                <ScrollView
                  ref={yearWheelRef}
                  style={styles.deadlineWheelColumn}
                  contentContainerStyle={styles.deadlineWheelContent}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={WHEEL_ITEM_HEIGHT}
                  decelerationRate="fast"
                  onMomentumScrollEnd={(event) => {
                    const index = readWheelIndex(event.nativeEvent.contentOffset.y, yearOptions.length);
                    setDeadlinePickerYear(yearOptions[index]);
                  }}
                  onScrollEndDrag={(event) => {
                    const index = readWheelIndex(event.nativeEvent.contentOffset.y, yearOptions.length);
                    setDeadlinePickerYear(yearOptions[index]);
                  }}
                >
                  {yearOptions.map((year) => (
                    <View key={`year_${year}`} style={styles.deadlineWheelItem}>
                      <Text style={[styles.deadlineWheelText, year === deadlinePickerYear && styles.deadlineWheelTextActive]}>
                        {year}年
                      </Text>
                    </View>
                  ))}
                </ScrollView>
                <ScrollView
                  ref={monthWheelRef}
                  style={styles.deadlineWheelColumn}
                  contentContainerStyle={styles.deadlineWheelContent}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={WHEEL_ITEM_HEIGHT}
                  decelerationRate="fast"
                  onMomentumScrollEnd={(event) => {
                    const index = readWheelIndex(event.nativeEvent.contentOffset.y, monthOptions.length);
                    setDeadlinePickerMonth(monthOptions[index]);
                  }}
                  onScrollEndDrag={(event) => {
                    const index = readWheelIndex(event.nativeEvent.contentOffset.y, monthOptions.length);
                    setDeadlinePickerMonth(monthOptions[index]);
                  }}
                >
                  {monthOptions.map((month) => (
                    <View key={`month_${month}`} style={styles.deadlineWheelItem}>
                      <Text
                        style={[
                          styles.deadlineWheelText,
                          month === deadlinePickerMonth && styles.deadlineWheelTextActive
                        ]}
                      >
                        {month}月
                      </Text>
                    </View>
                  ))}
                </ScrollView>
                <ScrollView
                  ref={dayWheelRef}
                  style={styles.deadlineWheelColumn}
                  contentContainerStyle={styles.deadlineWheelContent}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={WHEEL_ITEM_HEIGHT}
                  decelerationRate="fast"
                  onMomentumScrollEnd={(event) => {
                    const index = readWheelIndex(event.nativeEvent.contentOffset.y, dayOptions.length);
                    setDeadlinePickerDay(dayOptions[index]);
                  }}
                  onScrollEndDrag={(event) => {
                    const index = readWheelIndex(event.nativeEvent.contentOffset.y, dayOptions.length);
                    setDeadlinePickerDay(dayOptions[index]);
                  }}
                >
                  {dayOptions.map((day) => (
                    <View key={`day_${day}`} style={styles.deadlineWheelItem}>
                      <Text style={[styles.deadlineWheelText, day === deadlinePickerDay && styles.deadlineWheelTextActive]}>
                        {day}日
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            </View>
            <View style={styles.confirmActions}>
              <Pressable onPress={closeDeadlinePicker} style={pressable(styles.confirmGhost)}>
                <Text style={styles.confirmGhostText}>取消</Text>
              </Pressable>
              <Pressable onPress={applyDeadlinePicker} style={pressable(styles.button)}>
                <Text style={styles.buttonText}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView >
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
    position: "relative"
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.background
  },
  gridLineHorizontal: {
    position: "absolute",
    height: 1,
    left: 0,
    backgroundColor: "rgba(50, 45, 40, 0.06)"
  },
  gridLineVertical: {
    position: "absolute",
    width: 1,
    top: 0,
    backgroundColor: "rgba(50, 45, 40, 0.04)"
  },
  profileCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: theme.spacing.md,
    paddingVertical: theme.spacing.lg - 2,
    borderRadius: theme.radius.lg,
    backgroundColor: "#2B2A27",
    borderWidth: 1,
    borderColor: "#1E1D1A",
    position: "relative",
    marginBottom: theme.spacing.lg,
    shadowColor: "#0B1F2A",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  paperFoldTop: {
    position: "absolute",
    top: 8,
    right: 10,
    width: 26,
    height: 10,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    transform: [{ rotate: "7deg" }]
  },
  paperFoldBottom: {
    position: "absolute",
    bottom: 10,
    left: 12,
    width: 20,
    height: 6,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    transform: [{ rotate: "-6deg" }]
  },
  rewardFx: {
    position: "absolute",
    right: 12,
    top: -8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center"
  },
  rewardFxText: {
    fontSize: 14,
    fontWeight: "700"
  },
  rewardCoinRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 4
  },
  rewardCoin: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  profileLeft: {
    gap: 6
  },
  profileTitle: {
    fontSize: 26,
    color: "#FFFFFF",
    fontWeight: "700"
  },
  profileRight: {
    minWidth: 140,
    gap: 8
  },
  profileRow: {
    gap: 4
  },
  profileLabel: {
    fontSize: theme.font.sm,
    color: "rgba(255, 255, 255, 0.72)"
  },
  profileValue: {
    fontSize: 20,
    color: "#FFFFFF",
    fontWeight: "700"
  },
  profileValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  profileValueDark: {
    fontSize: 20,
    color: "#FFFFFF",
    fontWeight: "700"
  },
  profileActions: {
    flexDirection: "row",
    gap: 6
  },
  profileAction: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
    backgroundColor: "rgba(255, 255, 255, 0.08)"
  },
  profileActionText: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.78)",
    fontWeight: "600"
  },
  groupRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.sm
  },
  iconRow: {
    flexDirection: "row",
    gap: theme.spacing.sm
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background
  },
  iconDanger: {
    borderColor: "#F2B8B5",
    backgroundColor: "#FDF2F2"
  },
  iconText: {
    fontSize: 16,
    color: theme.colors.text
  },
  groupChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center"
  },
  groupChipText: {
    color: theme.colors.muted,
    fontWeight: "600"
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.sm
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "transparent"
  },
  colorDotActive: {
    borderColor: theme.colors.text
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    shadowColor: "#0B1F2A",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.sm
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm
  },
  pill: {
    backgroundColor: theme.colors.background,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4
  },
  pillInline: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.background,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    marginBottom: theme.spacing.sm
  },
  pillText: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    fontWeight: "600"
  },
  sectionTitle: {
    fontSize: theme.font.lg,
    color: theme.colors.text,
    fontWeight: "600"
  },
  sectionMeta: {
    fontSize: theme.font.sm,
    color: theme.colors.muted
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm
  },
  deadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm
  },
  deadlineCreateRow: {
    marginBottom: theme.spacing.sm
  },
  deadlineChip: {
    flex: 0,
    paddingHorizontal: theme.spacing.md
  },
  reminderTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.background
  },
  toggleRowActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft
  },
  reminderSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm
  },
  reminderSwitchLabel: {
    fontSize: theme.font.md,
    color: theme.colors.text,
    fontWeight: "600"
  },
  togglePill: {
    minWidth: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 4,
    alignItems: "center",
    backgroundColor: theme.colors.surface
  },
  togglePillActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent
  },
  togglePillText: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    fontWeight: "700"
  },
  togglePillTextActive: {
    color: "#FFFFFF"
  },
  sectionDisabled: {
    opacity: 0.5
  },
  sectionDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.sm
  },
  reminderList: {
    maxHeight: Math.min(420, SCREEN_HEIGHT * 0.5),
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm
  },
  reminderTaskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border
  },
  reminderTaskRowActive: {
    backgroundColor: theme.colors.accentSoft
  },
  reminderTaskTitle: {
    fontSize: theme.font.md,
    color: theme.colors.text,
    fontWeight: "600",
    lineHeight: 20
  },
  reminderTaskMeta: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    marginTop: 2,
    lineHeight: 18
  },
  reminderOptionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: theme.spacing.sm
  },
  reminderOptionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background
  },
  reminderOptionChipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft
  },
  reminderOptionChipText: {
    color: theme.colors.muted,
    fontSize: theme.font.sm,
    fontWeight: "600"
  },
  reminderOptionChipTextActive: {
    color: theme.colors.accent
  },
  reminderTaskCheck: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm
  },
  reminderTaskCheckActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent
  },
  reminderHintPill: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.background,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    marginBottom: theme.spacing.sm
  },
  reminderHintPillText: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    fontWeight: "600"
  },
  reminderTestButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    alignItems: "center"
  },
  reminderTestButtonText: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    fontWeight: "600"
  },
  typeRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm
  },
  typeChip: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background
  },
  typeChipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft
  },
  typeChipText: {
    color: theme.colors.muted,
    fontWeight: "600"
  },
  typeChipTextActive: {
    color: theme.colors.accent
  },
  input: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.font.md,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm
  },
  inputHint: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    marginTop: theme.spacing.sm
  },
  inputSmall: {
    flex: 1,
    marginBottom: 0
  },
  inputFlex: {
    flex: 1,
    marginBottom: 0
  },
  taskNameRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    alignItems: "center",
    marginBottom: theme.spacing.sm
  },
  templatePickButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background
  },
  templatePickIcon: {
    fontSize: 18
  },
  dropdownPanel: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
    overflow: "hidden"
  },
  dropdownModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(6, 13, 18, 0.5)",
    justifyContent: "center",
    padding: theme.spacing.md
  },
  dropdownModalCard: {
    width: "100%",
    maxHeight: "68%",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    shadowColor: "#0B1F2A",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4
  },
  dropdownScroll: {
    maxHeight: 220
  },
  dropdownItem: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border
  },
  inputTiny: {
    width: 84,
    marginBottom: 0
  },
  inputNoteDraft: {
    minHeight: 72,
    textAlignVertical: "top"
  },
  inputNote: {
    marginBottom: 0,
    marginTop: theme.spacing.sm
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    minHeight: 44
  },
  buttonSmall: {
    flex: 0,
    minWidth: 90
  },
  buttonTiny: {
    flex: 0,
    minWidth: 70
  },
  buttonDisabled: {
    backgroundColor: theme.colors.border
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    lineHeight: 18
  },
  muted: {
    color: theme.colors.muted,
    fontSize: theme.font.md
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border
  },
  taskMainColumn: {
    flex: 1
  },
  taskMeta: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    marginTop: 2
  },
  noteStrip: {
    marginTop: 6,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  noteStripText: {
    fontSize: theme.font.sm,
    color: theme.colors.text,
    lineHeight: 18
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    marginRight: theme.spacing.sm
  },
  checkboxDone: {
    backgroundColor: theme.colors.accent
  },
  taskTitle: {
    fontSize: theme.font.md,
    color: theme.colors.text,
    flex: 1
  },
  taskDone: {
    textDecorationLine: "line-through",
    color: theme.colors.muted
  },
  pointsBadge: {
    fontSize: theme.font.sm,
    color: theme.colors.accent,
    fontWeight: "600",
    marginRight: theme.spacing.sm
  },
  linkButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4
  },
  linkText: {
    color: theme.colors.accent,
    fontSize: theme.font.sm,
    fontWeight: "600"
  },
  linkTextInverse: {
    color: "#E6F6FA",
    fontSize: theme.font.sm,
    fontWeight: "600"
  },
  linkTextDanger: {
    color: theme.colors.danger,
    fontSize: theme.font.sm,
    fontWeight: "600"
  },
  actionIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background
  },
  actionIconText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  actionIconDanger: {
    color: theme.colors.danger
  },
  autoIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background
  },
  autoIconButtonActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft
  },
  autoIconText: {
    color: theme.colors.muted,
    fontSize: 14,
    fontWeight: "700"
  },
  autoIconTextActive: {
    color: theme.colors.accent
  },
  ruleChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background
  },
  ruleChipText: {
    fontSize: theme.font.sm,
    color: theme.colors.muted,
    fontWeight: "600"
  },
  pressablePressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }]
  },
  lineChart: {
    height: 120,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: theme.spacing.sm
  },
  lineSegment: {
    position: "absolute",
    height: 2,
    backgroundColor: theme.colors.accent
  },
  linePoint: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accent
  },
  linePointToday: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#FFFFFF"
  },
  chartAxis: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  chartTabs: {
    flexDirection: "row",
    gap: theme.spacing.sm
  },
  chartTab: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background
  },
  chartTabActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft
  },
  chartTabText: {
    color: theme.colors.muted,
    fontSize: theme.font.sm,
    fontWeight: "600"
  },
  chartTabTextActive: {
    color: theme.colors.accent
  },
  fabWrap: {
    position: "absolute",
    right: theme.spacing.lg,
    bottom: theme.spacing.lg
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: hexToRgba("#2B2A27", 0.88),
    borderWidth: 1,
    borderColor: hexToRgba("#FFFFFF", 0.18),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0B1F2A",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  },
  fabDocked: {
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14
  },
  fabIconStack: {
    width: 22,
    height: 18,
    position: "relative"
  },
  fabIconCard: {
    position: "absolute",
    width: 16,
    height: 12,
    borderRadius: 3,
    borderWidth: 1.6,
    borderColor: "#FFFFFF",
    backgroundColor: "transparent",
    top: 4,
    left: 3
  },
  fabIconCardBack: {
    top: 1,
    left: 0,
    opacity: 0.72
  },
  noticeToast: {
    position: "absolute",
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.lg + 68,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
    shadowColor: "#0B1F2A",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3
  },
  noticeToastText: {
    color: theme.colors.text,
    fontSize: theme.font.sm,
    fontWeight: "600"
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: theme.spacing.lg,
    gap: 6
  },
  emptyDesk: {
    width: 120,
    height: 8,
    borderRadius: 6,
    backgroundColor: "#D5CCBE"
  },
  emptyPaper: {
    width: 84,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    marginTop: -4
  },
  emptyPencil: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: -12
  },
  emptyPencilTip: {
    width: 8,
    height: 6,
    backgroundColor: "#B08968",
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2
  },
  emptyPencilBody: {
    width: 46,
    height: 8,
    backgroundColor: "#EAC18F"
  },
  emptyPencilEraser: {
    width: 12,
    height: 8,
    backgroundColor: "#D48B84",
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2
  },
  emptyText: {
    fontSize: theme.font.md,
    color: theme.colors.text,
    fontWeight: "600"
  },
  emptySub: {
    fontSize: theme.font.sm,
    color: theme.colors.muted
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12, 25, 33, 0.3)",
    justifyContent: "flex-end"
  },
  modalBackdropPress: {
    flex: 1
  },
  modalSheet: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: "70%"
  },
  reminderModalSheet: {
    maxHeight: "86%"
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12, 25, 33, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.md
  },
  confirmCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: "#0B1F2A",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
  },
  confirmText: {
    fontSize: theme.font.md,
    color: theme.colors.muted,
    marginTop: 8
  },
  confirmActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md
  },
  confirmGhost: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    backgroundColor: theme.colors.background
  },
  confirmGhostText: {
    fontSize: theme.font.md,
    color: theme.colors.muted,
    fontWeight: "600"
  },
  confirmDanger: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    alignItems: "center",
    backgroundColor: theme.colors.danger
  },
  confirmDangerText: {
    fontSize: theme.font.md,
    color: "#FFFFFF",
    fontWeight: "600"
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.sm
  },
  reminderHeaderMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm
  },
  modalActions: {
    flexDirection: "row",
    gap: 6
  },
  modalAction: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background
  },
  standaloneChip: {
    flex: 0,
    marginBottom: theme.spacing.sm
  },
  reminderTestRow: {
    flexDirection: "row",
    gap: theme.spacing.sm
  },
  reminderSubTabs: {
    marginTop: 2,
    marginBottom: theme.spacing.sm
  },
  modalActionText: {
    fontSize: 12,
    color: theme.colors.text,
    fontWeight: "600"
  },
  detailSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm
  },
  detailCard: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 8
  },
  detailCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2
  },
  detailTitle: {
    fontSize: 13,
    color: theme.colors.text,
    fontWeight: "600",
    flex: 1,
    marginRight: 8
  },
  detailBadge: {
    fontSize: 12,
    color: theme.colors.accent,
    fontWeight: "700"
  },
  detailMeta: {
    fontSize: 11,
    color: theme.colors.muted,
    marginTop: 2
  },
  detailNote: {
    fontSize: 11,
    color: theme.colors.text,
    marginTop: 4,
    lineHeight: 14
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border
  },
  historyValue: {
    fontSize: theme.font.md,
    color: theme.colors.text,
    fontWeight: "600"
  },
  axisLabel: {
    fontSize: theme.font.sm,
    color: theme.colors.muted
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm
  },
  weekLabel: {
    width: "14.2857%",
    textAlign: "center",
    color: theme.colors.muted,
    fontSize: theme.font.sm
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  calendarCell: {
    width: "14.2857%",
    alignItems: "center",
    paddingVertical: 4
  },
  dayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1
  },
  dayText: {
    fontSize: theme.font.sm,
    color: theme.colors.text
  },
  settleRow: {
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border
  },
  settleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm
  },
  settleMain: {
    marginBottom: theme.spacing.sm
  },
  settleControls: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing.sm
  },
  statusText: {
    fontSize: theme.font.sm,
    color: theme.colors.accent,
    marginTop: 4
  },
  deadlineWheelWrap: {
    position: "relative",
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm
  },
  deadlineWheelRow: {
    flexDirection: "row",
    gap: theme.spacing.sm
  },
  deadlineWheelColumn: {
    flex: 1,
    height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ROWS,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md
  },
  deadlineWheelContent: {
    paddingVertical: WHEEL_CONTENT_PADDING
  },
  deadlineWheelItem: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center"
  },
  deadlineWheelText: {
    fontSize: theme.font.md,
    color: theme.colors.muted
  },
  deadlineWheelTextActive: {
    color: theme.colors.text,
    fontWeight: "700"
  },
  deadlineWheelMask: {
    position: "absolute",
    left: 0,
    right: 0,
    top: (WHEEL_VISIBLE_ROWS / 2) * WHEEL_ITEM_HEIGHT - WHEEL_ITEM_HEIGHT / 2,
    height: WHEEL_ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
    opacity: 0.55,
    borderRadius: theme.radius.sm,
    zIndex: 1,
    pointerEvents: "none"
  }
});
