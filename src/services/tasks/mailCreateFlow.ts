import type { DbMessage } from "@/services/db/messages";
import { getStoredYandexOrgId } from "@/services/yandex/accountApi";
import type { Task, TaskPrincipalRef, TaskPriority } from "./domain";
import { getOrganizationTaskSettings } from "./organizationTaskSettings";
import type { TaskProvider, TaskProviderCapabilities } from "./taskProvider";
import { NO_TASK_PROVIDER_CAPABILITIES } from "./taskProvider";
import type { TaskRepository } from "./taskRepository";
import { SqliteTaskRepository } from "./taskRepository";
import { buildMailTaskUniqueKey, isTaskError, TaskError, type TaskErrorCode, YandexTrackerTaskProvider } from "./yandexTracker";

export interface MailTaskSourceSnapshot {
  accountId: string;
  messageId: string;
  threadId: string;
  rfcMessageId: string | null;
  subject: string | null;
  sender: string | null;
}

export interface CreateMailTaskInput {
  accountId: string;
  organizationId: string;
  clientTaskId: string;
  source: MailTaskSourceSnapshot;
  title: string;
  description?: string | null;
  assignee: TaskPrincipalRef;
  priority?: TaskPriority;
  dueAt?: number | null;
  followers?: TaskPrincipalRef[];
}

export type CreateTaskGateReason =
  | TaskErrorCode
  | "offline"
  | "read-only"
  | "queue-missing"
  | "org-missing";

export type CreateTaskGateResult =
  | {
      ok: true;
      organizationId: string;
      providerOrganizationId: string;
      defaultQueue: string;
      capabilities: TaskProviderCapabilities;
    }
  | {
      ok: false;
      code: CreateTaskGateReason;
      messageRu: string;
    };

export const CREATE_TASK_ERROR_COPY: Record<TaskErrorCode, string> = {
  unauthorized: "Нужна повторная авторизация Яндекс Tracker",
  "permission-denied": "Недостаточно прав для создания задачи",
  "configuration-required": "Для задач не настроена интеграция Tracker",
  "organization-mismatch": "Организация Tracker не совпадает с настройками",
  "assignee-unresolved": "Не удалось подтвердить исполнителя в организации Tracker",
  "queue-unavailable": "Очередь Tracker недоступна",
  conflict: "Конфликт при создании задачи",
  "not-found": "Ресурс Tracker не найден",
  "rate-limited": "Слишком много запросов к Tracker. Попробуйте позже",
  offline: "Нет сети — создание задачи недоступно",
  unavailable: "Tracker временно недоступен",
  "provider-unavailable": "Провайдер задач недоступен",
};

export function taskErrorMessageRu(error: unknown): string {
  if (isTaskError(error)) {
    return CREATE_TASK_ERROR_COPY[error.code] ?? error.message;
  }
  return CREATE_TASK_ERROR_COPY.unavailable;
}

function isOnline(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine;
  }
  return true;
}

export function snapshotMailSource(message: DbMessage): MailTaskSourceSnapshot {
  const sender = message.from_name
    ? `${message.from_name} <${message.from_address ?? ""}>`
    : (message.from_address ?? null);
  return {
    accountId: message.account_id,
    messageId: message.id,
    threadId: message.thread_id,
    rfcMessageId: message.message_id_header,
    subject: message.subject,
    sender,
  };
}

export function newClientTaskId(): string {
  return crypto.randomUUID();
}

export function createDefaultTrackerProvider(
  accountId: string,
  repository: TaskRepository = new SqliteTaskRepository(),
): YandexTrackerTaskProvider {
  return new YandexTrackerTaskProvider({ accountId, repository });
}

export async function evaluateCreateTaskGate(input: {
  accountId: string;
  provider?: TaskProvider;
  getOrgId?: (accountId: string) => Promise<string | null>;
  getSettings?: typeof getOrganizationTaskSettings;
  online?: () => boolean;
}): Promise<CreateTaskGateResult> {
  try {
    if (!(input.online ?? isOnline)()) {
      return { ok: false, code: "offline", messageRu: CREATE_TASK_ERROR_COPY.offline };
    }

    const orgId = (await (input.getOrgId ?? getStoredYandexOrgId)(input.accountId))?.trim() ?? "";
    if (!orgId) {
      return {
        ok: false,
        code: "org-missing",
        messageRu: "Не выбрана организация Яндекс 360 для задач",
      };
    }

    const settings = await (input.getSettings ?? getOrganizationTaskSettings)(orgId, "yandex-tracker");
    if (!settings?.enabled || !settings.providerOrganizationId?.trim()) {
      return {
        ok: false,
        code: "configuration-required",
        messageRu: CREATE_TASK_ERROR_COPY["configuration-required"],
      };
    }
    if (!settings.defaultQueue?.trim()) {
      return {
        ok: false,
        code: "queue-missing",
        messageRu: "Для задач не настроена очередь Tracker",
      };
    }

    const provider = input.provider ?? createDefaultTrackerProvider(input.accountId);
    let capabilities: TaskProviderCapabilities = NO_TASK_PROVIDER_CAPABILITIES;
    try {
      capabilities = await provider.capabilities(orgId);
    } catch (error) {
      if (isTaskError(error)) {
        return { ok: false, code: error.code, messageRu: taskErrorMessageRu(error) };
      }
      return { ok: false, code: "unavailable", messageRu: CREATE_TASK_ERROR_COPY.unavailable };
    }

    if (!capabilities.read) {
      return {
        ok: false,
        code: "unavailable",
        messageRu: "Yandex Tracker недоступен для этой организации",
      };
    }
    if (!capabilities.create) {
      return {
        ok: false,
        code: "read-only",
        messageRu: "Tracker доступен только для чтения — создание задач отключено",
      };
    }

    return {
      ok: true,
      organizationId: settings.organizationId,
      providerOrganizationId: settings.providerOrganizationId,
      defaultQueue: settings.defaultQueue,
      capabilities,
    };
  } catch {
    return {
      ok: false,
      code: "configuration-required",
      messageRu: CREATE_TASK_ERROR_COPY["configuration-required"],
    };
  }
}

export async function createTrackerTaskFromMail(input: {
  payload: CreateMailTaskInput;
  provider: TaskProvider;
  repository: TaskRepository;
  now?: () => number;
}): Promise<Task> {
  const { payload, provider, repository } = input;
  const now = input.now ?? (() => Math.floor(Date.now() / 1000));

  if (!payload.assignee?.email?.trim() && !payload.assignee?.providerUid?.trim()) {
    throw new TaskError("assignee-unresolved", "Assignee is required");
  }

  const unique = buildMailTaskUniqueKey({
    organizationId: payload.organizationId,
    accountId: payload.source.accountId,
    messageId: payload.source.messageId,
    clientTaskId: payload.clientTaskId,
  });

  const created = await provider.createTask({
    organizationId: payload.organizationId,
    unique,
    fields: {
      title: payload.title,
      description: payload.description ?? null,
      assignee: payload.assignee,
      priority: payload.priority ?? "normal",
      dueAt: payload.dueAt ?? null,
      followers: payload.followers ?? [],
    } as Task,
  });

  await repository.addSource({
    id: crypto.randomUUID(),
    taskId: created.id,
    type: "mail",
    accountId: payload.source.accountId,
    messageId: payload.source.messageId,
    threadId: payload.source.threadId,
    rfcMessageId: payload.source.rfcMessageId,
    subjectSnapshot: payload.source.subject,
    senderSnapshot: payload.source.sender,
    createdAt: now(),
  });

  return (await repository.get(created.id)) ?? created;
}
