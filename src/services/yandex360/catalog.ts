import type { Yandex360EndpointDefinition, Yandex360Scope } from "./types";

const DOC_BASE = "https://yandex.ru/dev/api360/doc/ru";

export const YANDEX360_API_BASE_URL = "https://cloud-api.yandex.net";

export const YANDEX360_SCOPES: Yandex360Scope[] = [
  { id: "directory:read_organization", label: "Чтение организаций", group: "organizations", access: "read" },
  { id: "directory:write_organization", label: "Изменение организации", group: "organizations", access: "write" },
  { id: "directory:read_departments", label: "Чтение подразделений", group: "departments", access: "read" },
  { id: "directory:write_departments", label: "Управление подразделениями", group: "departments", access: "write" },
  { id: "directory:read_groups", label: "Чтение групп", group: "groups", access: "read" },
  { id: "directory:write_groups", label: "Управление группами", group: "groups", access: "write" },
  { id: "directory:read_users", label: "Чтение сотрудников", group: "users", access: "read" },
  { id: "directory:write_users", label: "Управление сотрудниками", group: "users", access: "write" },
  { id: "directory:read_domains", label: "Чтение доменов", group: "domains", access: "read" },
  { id: "directory:write_domains", label: "Управление доменами", group: "domains", access: "write" },
  { id: "directory:manage_dns", label: "Управление DNS", group: "domains", access: "write" },
  { id: "directory:read_external_contacts", label: "Чтение внешних контактов", group: "externalContacts", access: "read" },
  { id: "directory:write_external_contacts", label: "Управление внешними контактами", group: "externalContacts", access: "write" },
  { id: "ya360_admin:mail_read_antispam_settings", label: "Чтение антиспама", group: "antispam", access: "read" },
  { id: "ya360_admin:mail_write_antispam_settings", label: "Управление антиспамом", group: "antispam", access: "write" },
  { id: "ya360_admin:mail_read_user_settings", label: "Чтение почтовых настроек сотрудников", group: "mailSettings", access: "read" },
  { id: "ya360_admin:mail_write_user_settings", label: "Управление почтовыми настройками сотрудников", group: "mailSettings", access: "write" },
  { id: "ya360_admin:mail_read_routing_rules", label: "Чтение правил обработки почты", group: "routing", access: "read" },
  { id: "ya360_admin:mail_write_routing_rules", label: "Управление правилами обработки почты", group: "routing", access: "write" },
  { id: "ya360_admin:mail_read_domain_routes", label: "Чтение маршрутизации домена", group: "routing", access: "read" },
  { id: "ya360_admin:mail_write_domain_routes", label: "Управление маршрутизацией домена", group: "routing", access: "write" },
  { id: "ya360_admin:mail_read_shared_mailbox_inventory", label: "Чтение общих ящиков", group: "mailboxes", access: "read" },
  { id: "ya360_admin:mail_write_shared_mailbox_inventory", label: "Управление общими ящиками", group: "mailboxes", access: "write" },
  { id: "ya360_admin:mail_read_organization_settings", label: "Чтение настроек почты организации", group: "mailSettings", access: "read" },
  { id: "ya360_admin:mail_write_organization_settings", label: "Управление настройками почты организации", group: "mailSettings", access: "write" },
  { id: "ya360_admin:mail_read_mail_list_permissions", label: "Чтение разрешений рассылок", group: "mailSettings", access: "read" },
  { id: "ya360_admin:mail_write_mail_list_permissions", label: "Изменение разрешений рассылок", group: "mailSettings", access: "write" },
  { id: "ya360_security:domain_2fa_write", label: "Управление обязательной 2FA", group: "security", access: "write" },
  { id: "ya360_security:domain_sessions_read", label: "Чтение сессий", group: "security", access: "read" },
  { id: "ya360_security:domain_sessions_write", label: "Управление сессиями", group: "security", access: "write" },
  { id: "ya360_security:domain_passwords_read", label: "Чтение политики паролей", group: "security", access: "read" },
  { id: "ya360_security:domain_passwords_write", label: "Управление политикой паролей", group: "security", access: "write" },
  { id: "ya360_security:domain_settings_read", label: "Чтение настроек безопасности", group: "security", access: "read" },
  { id: "ya360_security:domain_settings_write", label: "Управление настройками безопасности", group: "security", access: "write" },
  { id: "ya360_security:service_applications_read", label: "Чтение сервисных приложений", group: "serviceApplications", access: "read" },
  { id: "ya360_security:service_applications_write", label: "Управление сервисными приложениями", group: "serviceApplications", access: "write" },
  { id: "ya360_security:audit_log_disk", label: "Аудит-лог Диска", group: "auditLogs", access: "read" },
  { id: "ya360_security:audit_log_mail", label: "Аудит-лог Почты", group: "auditLogs", access: "read" },
  { id: "ya360_security:read_auditlog", label: "Аудит-лог организации", group: "auditLogs", access: "read" },
];

export const YANDEX360_MAIL_SCOPES = ["mail:imap_full", "mail:smtp"] as const;

export const YANDEX360_ADMIN_SCOPES = YANDEX360_SCOPES.map((scope) => scope.id);

export const YANDEX360_DEFAULT_SCOPES = [
  ...YANDEX360_MAIL_SCOPES,
  ...YANDEX360_ADMIN_SCOPES,
];

export const YANDEX360_ENDPOINTS: Yandex360EndpointDefinition[] = [
  endpoint("organizations.list", "organizations", "Организации", "Список организаций, доступных OAuth-пользователю.", "GET", "/v1/orgs", ["directory:read_organization"], "read", `${DOC_BASE}/ref/OrganizationsService/`),
  endpoint("organizations.get", "organizations", "Получить организацию", "Информация об организации.", "GET", "/v1/orgs/{orgId}", ["directory:read_organization"], "read", `${DOC_BASE}/ref/OrganizationsService/`, ["orgId"]),
  endpoint("organizations.update", "organizations", "Изменить организацию", "Изменение профиля организации.", "PATCH", "/v1/orgs/{orgId}", ["directory:write_organization"], "write", `${DOC_BASE}/ref/OrganizationsService/`, ["orgId"], undefined, { name: "New organization name" }),

  endpoint("users.list", "users", "Сотрудники", "Просмотр сотрудников организации.", "GET", "/v1/orgs/{orgId}/users", ["directory:read_users"], "read", `${DOC_BASE}/ref/UserService/`, ["orgId"], ["pageToken", "pageSize"]),
  endpoint("users.create", "users", "Создать сотрудника", "Создание пользователя на домене организации.", "POST", "/v1/orgs/{orgId}/users", ["directory:write_users"], "write", `${DOC_BASE}/ref/UserService/`, ["orgId"], undefined, { name: { first: "Ivan", last: "Ivanov" }, nickname: "ivan", departmentId: "1" }),
  endpoint("users.get", "users", "Получить сотрудника", "Карточка сотрудника.", "GET", "/v1/orgs/{orgId}/users/{userId}", ["directory:read_users"], "read", `${DOC_BASE}/ref/UserService/`, ["orgId", "userId"]),
  endpoint("users.update", "users", "Изменить сотрудника", "Изменение данных сотрудника.", "PATCH", "/v1/orgs/{orgId}/users/{userId}", ["directory:write_users"], "write", `${DOC_BASE}/ref/UserService/`, ["orgId", "userId"], undefined, { name: { first: "Ivan", last: "Petrov" } }),
  endpoint("users.delete", "users", "Удалить сотрудника", "Удаление сотрудника из организации.", "DELETE", "/v1/orgs/{orgId}/users/{userId}", ["directory:write_users"], "destructive", `${DOC_BASE}/ref/UserService/`, ["orgId", "userId"]),

  endpoint("groups.list", "groups", "Группы", "Просмотр групп организации.", "GET", "/v1/orgs/{orgId}/groups", ["directory:read_groups"], "read", `${DOC_BASE}/ref/GroupService/`, ["orgId"], ["pageToken", "pageSize"]),
  endpoint("groups.create", "groups", "Создать группу", "Создание группы.", "POST", "/v1/orgs/{orgId}/groups", ["directory:write_groups"], "write", `${DOC_BASE}/ref/GroupService/`, ["orgId"], undefined, { name: "Marketing", email: "marketing@example.com" }),
  endpoint("groups.get", "groups", "Получить группу", "Данные группы.", "GET", "/v1/orgs/{orgId}/groups/{groupId}", ["directory:read_groups"], "read", `${DOC_BASE}/ref/GroupService/`, ["orgId", "groupId"]),
  endpoint("groups.update", "groups", "Изменить группу", "Изменение группы.", "PATCH", "/v1/orgs/{orgId}/groups/{groupId}", ["directory:write_groups"], "write", `${DOC_BASE}/ref/GroupService/`, ["orgId", "groupId"], undefined, { name: "Growth" }),
  endpoint("groups.delete", "groups", "Удалить группу", "Удаление группы.", "DELETE", "/v1/orgs/{orgId}/groups/{groupId}", ["directory:write_groups"], "destructive", `${DOC_BASE}/ref/GroupService/`, ["orgId", "groupId"]),
  endpoint("groups.addMembers", "groups", "Добавить участников", "Добавление сотрудников в группу.", "POST", "/v1/orgs/{orgId}/groups/{groupId}/members", ["directory:write_groups"], "write", `${DOC_BASE}/ref/GroupService/`, ["orgId", "groupId"], undefined, { members: [{ id: "user-id" }] }),
  endpoint("groups.deleteMembers", "groups", "Удалить участников", "Удаление сотрудников из группы.", "DELETE", "/v1/orgs/{orgId}/groups/{groupId}/members", ["directory:write_groups"], "destructive", `${DOC_BASE}/ref/GroupService/`, ["orgId", "groupId"], undefined, { members: [{ id: "user-id" }] }),

  endpoint("departments.list", "departments", "Подразделения", "Просмотр подразделений.", "GET", "/v1/orgs/{orgId}/departments", ["directory:read_departments"], "read", `${DOC_BASE}/ref/DepartmentService/`, ["orgId"]),
  endpoint("departments.create", "departments", "Создать подразделение", "Создание подразделения.", "POST", "/v1/orgs/{orgId}/departments", ["directory:write_departments"], "write", `${DOC_BASE}/ref/DepartmentService/`, ["orgId"], undefined, { name: "Sales", parentId: "1" }),
  endpoint("departments.update", "departments", "Изменить подразделение", "Изменение подразделения.", "PATCH", "/v1/orgs/{orgId}/departments/{departmentId}", ["directory:write_departments"], "write", `${DOC_BASE}/ref/DepartmentService/`, ["orgId", "departmentId"], undefined, { name: "Enterprise Sales" }),
  endpoint("departments.delete", "departments", "Удалить подразделение", "Удаление подразделения.", "DELETE", "/v1/orgs/{orgId}/departments/{departmentId}", ["directory:write_departments"], "destructive", `${DOC_BASE}/ref/DepartmentService/`, ["orgId", "departmentId"]),

  endpoint("externalContacts.list", "externalContacts", "Внешние контакты", "Просмотр внешних контактов.", "GET", "/v1/orgs/{orgId}/external-contacts", ["directory:read_external_contacts"], "read", `${DOC_BASE}/ref/ExternalContactService`, ["orgId"]),
  endpoint("externalContacts.create", "externalContacts", "Создать внешний контакт", "Создание внешнего контакта.", "POST", "/v1/orgs/{orgId}/external-contacts", ["directory:write_external_contacts"], "write", `${DOC_BASE}/ref/ExternalContactService`, ["orgId"], undefined, { email: "partner@example.com", name: "Partner" }),
  endpoint("externalContacts.update", "externalContacts", "Изменить внешний контакт", "Изменение внешнего контакта.", "PATCH", "/v1/orgs/{orgId}/external-contacts/{contactId}", ["directory:write_external_contacts"], "write", `${DOC_BASE}/ref/ExternalContactService`, ["orgId", "contactId"], undefined, { name: "New Partner Name" }),
  endpoint("externalContacts.delete", "externalContacts", "Удалить внешний контакт", "Удаление внешнего контакта.", "DELETE", "/v1/orgs/{orgId}/external-contacts/{contactId}", ["directory:write_external_contacts"], "destructive", `${DOC_BASE}/ref/ExternalContactService`, ["orgId", "contactId"]),

  endpoint("domains.list", "domains", "Домены", "Список доменов организации.", "GET", "/v1/orgs/{orgId}/domains", ["directory:read_domains"], "read", `${DOC_BASE}/ref/DomainService/`, ["orgId"]),
  endpoint("domains.create", "domains", "Добавить домен", "Добавление домена в организацию.", "POST", "/v1/orgs/{orgId}/domains", ["directory:write_domains"], "write", `${DOC_BASE}/ref/DomainService/`, ["orgId"], undefined, { name: "example.com" }),
  endpoint("domains.delete", "domains", "Удалить домен", "Удаление домена.", "DELETE", "/v1/orgs/{orgId}/domains/{domain}", ["directory:write_domains"], "destructive", `${DOC_BASE}/ref/DomainService/`, ["orgId", "domain"]),
  endpoint("domains.status", "domains", "Статус домена", "Статус подключения домена.", "GET", "/v1/orgs/{orgId}/domains/{domain}/status", ["directory:read_domains"], "read", `${DOC_BASE}/ref/DomainService/`, ["orgId", "domain"]),
  endpoint("domains.dns.list", "domains", "DNS-записи", "Список DNS-записей домена.", "GET", "/v1/orgs/{orgId}/domains/{domain}/dns-records", ["directory:read_domains"], "read", `${DOC_BASE}/ref/DomainService/`, ["orgId", "domain"]),
  endpoint("domains.dns.update", "domains", "Изменить DNS-записи", "Управление DNS-записями домена.", "PATCH", "/v1/orgs/{orgId}/domains/{domain}/dns-records", ["directory:manage_dns"], "write", `${DOC_BASE}/ref/DomainService/`, ["orgId", "domain"], undefined, { records: [] }),

  endpoint("mailboxes.shared.list", "mailboxes", "Общие ящики", "Просмотр общих ящиков.", "GET", "/v1/orgs/{orgId}/mailboxes/shared", ["ya360_admin:mail_read_shared_mailbox_inventory"], "read", `${DOC_BASE}/ref/MailboxService/`, ["orgId"]),
  endpoint("mailboxes.shared.create", "mailboxes", "Создать общий ящик", "Создание общего ящика.", "POST", "/v1/orgs/{orgId}/mailboxes/shared", ["ya360_admin:mail_write_shared_mailbox_inventory"], "write", `${DOC_BASE}/ref/MailboxService/`, ["orgId"], undefined, { email: "support@example.com", name: "Support" }),
  endpoint("mailboxes.shared.update", "mailboxes", "Изменить общий ящик", "Изменение общего ящика.", "PATCH", "/v1/orgs/{orgId}/mailboxes/shared/{mailboxId}", ["ya360_admin:mail_write_shared_mailbox_inventory"], "write", `${DOC_BASE}/ref/MailboxService/`, ["orgId", "mailboxId"], undefined, { name: "Customer Support" }),
  endpoint("mailboxes.shared.delete", "mailboxes", "Удалить общий ящик", "Удаление общего ящика.", "DELETE", "/v1/orgs/{orgId}/mailboxes/shared/{mailboxId}", ["ya360_admin:mail_write_shared_mailbox_inventory"], "destructive", `${DOC_BASE}/ref/MailboxService/`, ["orgId", "mailboxId"]),
  endpoint("mailboxes.access.list", "mailboxes", "Доступы к ящику", "Список сотрудников с доступом к ящику.", "GET", "/v1/orgs/{orgId}/mailboxes/{mailboxId}/actors", ["ya360_admin:mail_read_shared_mailbox_inventory"], "read", `${DOC_BASE}/ref/MailboxService/`, ["orgId", "mailboxId"]),
  endpoint("mailboxes.access.set", "mailboxes", "Изменить доступ к ящику", "Предоставление или изменение доступа.", "PUT", "/v1/orgs/{orgId}/mailboxes/{mailboxId}/actors/{userId}", ["ya360_admin:mail_write_shared_mailbox_inventory"], "write", `${DOC_BASE}/ref/MailboxService/`, ["orgId", "mailboxId", "userId"], undefined, { role: "read_write" }),

  endpoint("mailSettings.organization.get", "mailSettings", "Настройки почты организации", "Просмотр общих настроек почты.", "GET", "/v1/orgs/{orgId}/mail/settings", ["ya360_admin:mail_read_organization_settings"], "read", `${DOC_BASE}/mail-settings/`, ["orgId"]),
  endpoint("mailSettings.organization.patch", "mailSettings", "Изменить настройки почты", "Изменение общих настроек почты.", "PATCH", "/v1/orgs/{orgId}/mail/settings", ["ya360_admin:mail_write_organization_settings"], "write", `${DOC_BASE}/mail-settings/`, ["orgId"], undefined, { enable_imap: true, enable_pop: false }),
  endpoint("mailSettings.user.addressBook.get", "mailSettings", "Автосбор контактов", "Статус автоматического сбора контактов сотрудника.", "GET", "/v1/orgs/{orgId}/users/{userId}/mail/settings/address-book", ["ya360_admin:mail_read_user_settings"], "read", `${DOC_BASE}/ref/MailUserSettingsService/`, ["orgId", "userId"]),
  endpoint("mailSettings.user.addressBook.set", "mailSettings", "Изменить автосбор контактов", "Включение или выключение автосбора контактов.", "PUT", "/v1/orgs/{orgId}/users/{userId}/mail/settings/address-book", ["ya360_admin:mail_write_user_settings"], "write", `${DOC_BASE}/ref/MailUserSettingsService/`, ["orgId", "userId"], undefined, { enabled: true }),
  endpoint("mailSettings.user.senderInfo.get", "mailSettings", "Адрес и подписи", "Основной адрес и подписи сотрудника.", "GET", "/v1/orgs/{orgId}/users/{userId}/mail/settings/sender-info", ["ya360_admin:mail_read_user_settings"], "read", `${DOC_BASE}/ref/MailUserSettingsService/`, ["orgId", "userId"]),
  endpoint("mailSettings.user.senderInfo.set", "mailSettings", "Изменить адрес и подписи", "Изменение основного адреса и подписей.", "PUT", "/v1/orgs/{orgId}/users/{userId}/mail/settings/sender-info", ["ya360_admin:mail_write_user_settings"], "write", `${DOC_BASE}/ref/MailUserSettingsService/`, ["orgId", "userId"], undefined, { defaultFrom: "user@example.com", signatures: [] }),
  endpoint("mailSettings.user.rules.list", "mailSettings", "Автоответы и пересылки", "Правила автоответа и пересылки.", "GET", "/v1/orgs/{orgId}/users/{userId}/mail/settings/rules", ["ya360_admin:mail_read_user_settings"], "read", `${DOC_BASE}/ref/MailUserSettingsService/`, ["orgId", "userId"]),
  endpoint("mailSettings.user.rules.create", "mailSettings", "Создать правило почты", "Создание правила автоответа или пересылки.", "POST", "/v1/orgs/{orgId}/users/{userId}/mail/settings/rules", ["ya360_admin:mail_write_user_settings"], "write", `${DOC_BASE}/ref/MailUserSettingsService/`, ["orgId", "userId"], undefined, { type: "forward", enabled: true }),
  endpoint("mailSettings.user.rules.delete", "mailSettings", "Удалить правило почты", "Удаление правила автоответа или пересылки.", "DELETE", "/v1/orgs/{orgId}/users/{userId}/mail/settings/rules/{ruleId}", ["ya360_admin:mail_write_user_settings"], "destructive", `${DOC_BASE}/ref/MailUserSettingsService/`, ["orgId", "userId", "ruleId"]),

  endpoint("antispam.get", "antispam", "Антиспам", "Просмотр настроек антиспама.", "GET", "/v1/orgs/{orgId}/mail/antispam/settings", ["ya360_admin:mail_read_antispam_settings"], "read", `${DOC_BASE}/access`, ["orgId"]),
  endpoint("antispam.patch", "antispam", "Изменить антиспам", "Изменение настроек антиспама.", "PATCH", "/v1/orgs/{orgId}/mail/antispam/settings", ["ya360_admin:mail_write_antispam_settings"], "write", `${DOC_BASE}/access`, ["orgId"], undefined, { enabled: true }),
  endpoint("routing.rules.list", "routing", "Правила обработки писем", "Просмотр правил обработки писем для домена.", "GET", "/v1/orgs/{orgId}/domains/{domain}/mail/routing-rules", ["ya360_admin:mail_read_routing_rules"], "read", `${DOC_BASE}/access`, ["orgId", "domain"]),
  endpoint("routing.rules.create", "routing", "Создать правило обработки", "Создание правила обработки писем.", "POST", "/v1/orgs/{orgId}/domains/{domain}/mail/routing-rules", ["ya360_admin:mail_write_routing_rules"], "write", `${DOC_BASE}/access`, ["orgId", "domain"], undefined, { enabled: true, condition: {}, actions: [] }),
  endpoint("routing.rules.update", "routing", "Изменить правило обработки", "Изменение правила обработки писем.", "PATCH", "/v1/orgs/{orgId}/domains/{domain}/mail/routing-rules/{ruleId}", ["ya360_admin:mail_write_routing_rules"], "write", `${DOC_BASE}/access`, ["orgId", "domain", "ruleId"], undefined, { enabled: false }),
  endpoint("routing.rules.delete", "routing", "Удалить правило обработки", "Удаление правила обработки писем.", "DELETE", "/v1/orgs/{orgId}/domains/{domain}/mail/routing-rules/{ruleId}", ["ya360_admin:mail_write_routing_rules"], "destructive", `${DOC_BASE}/access`, ["orgId", "domain", "ruleId"]),

  endpoint("security.settings.get", "security", "Настройки безопасности", "Просмотр настроек безопасности домена.", "GET", "/v1/orgs/{orgId}/security/settings", ["ya360_security:domain_settings_read"], "read", `${DOC_BASE}/access`, ["orgId"]),
  endpoint("security.settings.patch", "security", "Изменить безопасность", "Изменение настроек безопасности домена.", "PATCH", "/v1/orgs/{orgId}/security/settings", ["ya360_security:domain_settings_write"], "write", `${DOC_BASE}/access`, ["orgId"], undefined, { allowExternalOauth: false }),
  endpoint("security.sessions.list", "security", "Сессии сотрудников", "Просмотр авторизационных cookie-сессий.", "GET", "/v1/orgs/{orgId}/security/sessions", ["ya360_security:domain_sessions_read"], "read", `${DOC_BASE}/access`, ["orgId"]),
  endpoint("security.sessions.revoke", "security", "Отозвать сессию", "Завершение авторизационной сессии.", "DELETE", "/v1/orgs/{orgId}/security/sessions/{sessionId}", ["ya360_security:domain_sessions_write"], "destructive", `${DOC_BASE}/access`, ["orgId", "sessionId"]),
  endpoint("security.passwords.get", "security", "Политика паролей", "Просмотр параметров паролей.", "GET", "/v1/orgs/{orgId}/security/passwords", ["ya360_security:domain_passwords_read"], "read", `${DOC_BASE}/access`, ["orgId"]),
  endpoint("security.passwords.patch", "security", "Изменить политику паролей", "Управление параметрами паролей.", "PATCH", "/v1/orgs/{orgId}/security/passwords", ["ya360_security:domain_passwords_write"], "write", `${DOC_BASE}/access`, ["orgId"], undefined, { minLength: 12 }),
  endpoint("security.2fa.set", "security", "Обязательная 2FA", "Управление обязательной двухфакторной аутентификацией.", "PUT", "/v1/orgs/{orgId}/security/2fa", ["ya360_security:domain_2fa_write"], "write", `${DOC_BASE}/access`, ["orgId"], undefined, { enabled: true }),

  endpoint("serviceApplications.list", "serviceApplications", "Сервисные приложения", "Просмотр сервисных приложений.", "GET", "/v1/orgs/{orgId}/security/service-applications", ["ya360_security:service_applications_read"], "read", `${DOC_BASE}/ref/ServiceApplicationsService/`, ["orgId"]),
  endpoint("serviceApplications.create", "serviceApplications", "Создать сервисное приложение", "Создание сервисного приложения.", "POST", "/v1/orgs/{orgId}/security/service-applications", ["ya360_security:service_applications_write"], "write", `${DOC_BASE}/ref/ServiceApplicationsService/`, ["orgId"], undefined, { name: "Integration" }),
  endpoint("serviceApplications.update", "serviceApplications", "Изменить сервисное приложение", "Изменение сервисного приложения.", "PATCH", "/v1/orgs/{orgId}/security/service-applications/{appId}", ["ya360_security:service_applications_write"], "write", `${DOC_BASE}/ref/ServiceApplicationsService/`, ["orgId", "appId"], undefined, { name: "Integration v2" }),
  endpoint("serviceApplications.delete", "serviceApplications", "Удалить сервисное приложение", "Удаление сервисного приложения.", "DELETE", "/v1/orgs/{orgId}/security/service-applications/{appId}", ["ya360_security:service_applications_write"], "destructive", `${DOC_BASE}/ref/ServiceApplicationsService/`, ["orgId", "appId"]),

  endpoint("auditLogs.organization", "auditLogs", "Аудит-лог организации", "Получение событий аудит-лога организации.", "GET", "/v1/auditlog/organizations/{orgId}/events", ["ya360_security:read_auditlog"], "read", `${DOC_BASE}/audit-logs/get-logs`, ["orgId"], ["started_at", "ended_at", "types", "include_uids", "exclude_uids", "ip", "service", "count", "page_token"]),
  endpoint("auditLogs.disk", "auditLogs", "Аудит-лог Диска", "Получение событий аудит-лога Диска.", "GET", "/v1/auditlog/organizations/{orgId}/disk/events", ["ya360_security:audit_log_disk"], "read", `${DOC_BASE}/ref/AuditLogService/AuditLogService_Disk`, ["orgId"], ["started_at", "ended_at", "count", "page_token"]),
  endpoint("auditLogs.mail", "auditLogs", "Аудит-лог Почты", "Получение событий аудит-лога Почты.", "GET", "/v1/auditlog/organizations/{orgId}/mail/events", ["ya360_security:audit_log_mail"], "read", `${DOC_BASE}/access`, ["orgId"], ["started_at", "ended_at", "count", "page_token"]),
];

function endpoint(
  id: Yandex360EndpointDefinition["id"],
  group: Yandex360EndpointDefinition["group"],
  label: string,
  description: string,
  method: Yandex360EndpointDefinition["method"],
  path: string,
  scopes: string[],
  risk: Yandex360EndpointDefinition["risk"],
  documentationUrl: string,
  pathParams?: string[],
  queryParams?: string[],
  bodyExample?: Yandex360EndpointDefinition["bodyExample"],
): Yandex360EndpointDefinition {
  return {
    id,
    group,
    label,
    description,
    method,
    path,
    scopes,
    risk,
    pathParams,
    queryParams,
    bodyExample,
    documentationUrl,
  };
}

export function getYandex360Endpoint(id: string): Yandex360EndpointDefinition | null {
  return YANDEX360_ENDPOINTS.find((endpointDef) => endpointDef.id === id) ?? null;
}
