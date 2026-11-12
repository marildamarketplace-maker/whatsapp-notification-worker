import { z } from 'zod';
import { DeliveryError, type ImageAttachment } from '../types/notification.js';
import { formatMessage } from './recipient.service.js';

export const IMAGE_PREFIX = 'whatsapp:image:v1\n';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const maxBase64Length = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const imageSchema = z.object({
  media: z.string().min(1).max(maxBase64Length),
  mimetype: z.enum(['image/jpeg','image/png']),
  caption: z.string().max(1000).default(''),
}).strict();

export function validateImage(image: ImageAttachment): void {
  const invalid = () => new DeliveryError('permanent','INVALID_IMAGE_PAYLOAD');
  if (!imageSchema.safeParse(image).success || image.media.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.media)) throw invalid();
  const bytes = Buffer.from(image.media,'base64');
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== image.media) throw invalid();
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 &&
    bytes[bytes.length-2] === 255 && bytes[bytes.length-1] === 217;
  if (!(image.mimetype === 'image/png' ? png : jpeg)) throw invalid();
}

export function prepareMessage(title: string, message: string): {text: string; image?: ImageAttachment} {
  if (!message.startsWith(IMAGE_PREFIX)) return {text:formatMessage(title,message)};
  if (message.length > maxBase64Length + 16384) throw new DeliveryError('permanent','INVALID_IMAGE_PAYLOAD');
  const value = imageSchema.parse(JSON.parse(message.slice(IMAGE_PREFIX.length)));
  const image: ImageAttachment = {media:value.media,mimetype:value.mimetype};
  validateImage(image);
  const text = formatMessage(title,value.caption).trim();
  if (text.length > 1024) throw new DeliveryError('permanent','INVALID_IMAGE_PAYLOAD');
  return {text,image};
}
