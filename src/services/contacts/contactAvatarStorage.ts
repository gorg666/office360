import { invoke } from "@tauri-apps/api/core";

const AVATAR_SIZE = 300;
const AVATAR_MIME = "image/jpeg";
const AVATAR_QUALITY = 0.9;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read avatar image"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load avatar image"));
    image.src = dataUrl;
  });
}

export async function prepareContactAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context || image.naturalWidth === 0 || image.naturalHeight === 0) {
    return dataUrl;
  }

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  return canvas.toDataURL(AVATAR_MIME, AVATAR_QUALITY);
}

export async function saveContactAvatarDataUrl(dataUrl: string): Promise<string> {
  return invoke<string>("save_contact_avatar", { dataUrl });
}

export function isManagedContactAvatar(avatarUrl: string | null | undefined): avatarUrl is string {
  if (!avatarUrl) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(avatarUrl)) return false;
  return avatarUrl.includes("/contact-avatars/") || avatarUrl.includes("\\contact-avatars\\");
}

export async function deleteStoredContactAvatar(avatarUrl: string | null | undefined): Promise<void> {
  if (!isManagedContactAvatar(avatarUrl)) return;
  await invoke("delete_contact_avatar", { avatarUrl });
}
