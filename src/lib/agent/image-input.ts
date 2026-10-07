/** Bounded inline image wire format. Remote URLs are deliberately excluded. */
export interface ImageInput { url: string }
export const MAX_IMAGE_CHARS = 100_000;
export const MAX_REQUEST_IMAGES = 8;
export function isInlineImage(value: unknown): value is ImageInput {
  if (!value || typeof value !== "object") return false;
  const url = (value as ImageInput).url;
  if (typeof url !== "string" || url.length > MAX_IMAGE_CHARS) return false;
  return /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url);
}
export function imageParts(image: ImageInput) {
  const [header, data] = image.url.split(",");
  return { mimeType: header.slice(5, header.indexOf(";")), data };
}
