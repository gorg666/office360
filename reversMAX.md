Коротко: MAX “заработал” не из-за одной настройки, а потому что мы разделили два режима и для “самописного” режима воспроизвели минимальный протокол клиента MAX на стороне Tauri/Rust.

Что было сделано
Официальный Bot API Для ботов всё просто: запросы идут на https://platform-api.max.ru, token передаётся в Authorization, а браузерный fetch заменён на Rust/Tauri proxy, чтобы не упираться в CORS/CSP.

Это видно в src-tauri/src/messengers.rs: MAX_PLATFORM_API_URL, messenger_request, заголовок Authorization.

Пользовательский MAX-клиент Это уже не официальный Bot API. Там используется клиентский socket-протокол MAX:


messengers.rs
Lines 434-459
fn connect_max_socket() -> Result<MaxSocket, String> {
    let tcp = StdTcpStream::connect((MAX_CLIENT_SOCKET_HOST, MAX_CLIENT_SOCKET_PORT))
        .map_err(|error| format!("MAX socket connection failed: {error}"))?;
    // ...
    let stream = connector
        .connect(MAX_CLIENT_SOCKET_HOST, tcp)
        .map_err(|error| format!("MAX TLS connection failed: {error}"))?;
    Ok(MaxSocket { stream, seq: 0 })
}
fn handshake_max_socket(socket: &mut MaxSocket) -> Result<Value, String> {
    send_max_socket_command(
        socket,
        OPCODE_HANDSHAKE,
        json!({
            "deviceId": "velo-desktop",
            "userAgent": max_user_agent()
        }),
    )
То есть приложение подключается не как обычный сайт, а как клиент:

host: api.oneme.ru
port: 443
TLS через native_tls
user-agent похож на обычный Chrome/Windows
первый пакет: handshake opcode 6
Подбор последовательности авторизации Я ориентировался на то, как ведёт себя web/desktop-клиент и на структуру уже найденного MaxClient-подхода. В итоге получилась цепочка opcodes:
17 — запрос SMS-кода
18 — проверка SMS-кода
115 — проверка пароля, если MAX требует пароль
23 — завершение регистрации, если аккаунт новый
19 — authenticate по login token
Это в src-tauri/src/messengers.rs объявлено как константы OPCODE_*.

После входа После получения token клиент делает authenticate и получает session: профиль, чаты, контакты. Затем:
49 — история чата
64 — отправка сообщения
50 — mark as read
75 — подписка на события чата
80/82/87 — загрузка фото/видео/файлов
Пример отправки:


messengers.rs
Lines 317-356
pub async fn max_client_send_message(
    token: String,
    chat_id: String,
    text: String,
    reply_id: Option<String>,
    attachments: Option<Vec<MaxClientAttachmentUpload>>,
) -> Result<Value, String> {
    // ...
    send_max_socket_command(
        &mut socket,
        OPCODE_SEND_MESSAGE,
        json!({
            "chatId": parse_i64(&chat_id, "chat_id")?,
            "message": message,
            "notify": true
        }),
    )
Почему сообщения сначала были “пустые” У MAX текст может лежать в разных местах: body.text, message.text, text. Поэтому парсер пришлось сделать терпимым к нескольким формам ответа:

maxBotApi.ts
Lines 91-100
function messageText(message: MaxMessage | undefined): string {
  if (!message) return "Событие MAX";
  const nestedMessage = isRecord(message.message) ? message.message : null;
  const body = isRecord(message.body) ? message.body : null;
  const text = stringValue(body?.text) ?? stringValue(nestedMessage?.text) ?? stringValue(message.text);
  const attachments = message.body?.attachments ?? message.message?.attaches ?? message.message?.attachments ?? message.attaches ?? message.attachments;
  if (text?.trim()) return text;
  if (attachments?.length) return `Вложения: ${attachments.length}`;
  if (message.link) return "Пересланное/ответное сообщение";
  return "Сообщение без текста";
}
Главное
Настройки были подобраны так:

вынести сетевой слой в Rust, потому что браузер/WebView не даёт нормально эмулировать клиентские socket-заголовки и бинарный протокол;
использовать TLS-соединение к api.oneme.ru:443;
повторить handshake/auth flow MAX-клиента через opcodes;
хранить полученный login token локально;
нормализовать разные формы payload, потому что MAX возвращает не “чистый REST JSON”, а клиентские структуры.
Но важно: это не официальный публичный user-client API. Он может сломаться, если MAX поменяет протокол, opcodes, формат пакетов или начнёт жёстче проверять устройство/клиент.