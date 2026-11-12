// Browser-side image preparation for image search: decode, downscale, re-encode as PNG.
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
// Vercel rejects request bodies over 4.5 MB; base64 adds ~33%, so keep the PNG under 3 MB.
export const MAX_PNG_BYTES = 3 * 1024 * 1024;
const SIZES = [1024, 768, 512, 384];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh này. Hãy thử ảnh PNG hoặc JPEG.'));
    img.src = url;
  });
}

function toBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Không đọc được ảnh này.'));
    reader.readAsDataURL(blob);
  });
}

/** Returns { mime: 'image/png', data: <base64 without data: prefix> }. `url` is an object URL of `file`. */
export async function imageToPng(file, url) {
  if (!file.type.startsWith('image/')) throw new Error('Tệp được chọn không phải là ảnh.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Ảnh quá lớn (tối đa 25 MB).');
  const img = await loadImage(url);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error('Không đọc được ảnh này.');
  for (const side of SIZES) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // flatten transparency so it does not turn black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas);
    if (blob && blob.size <= MAX_PNG_BYTES) return { mime: 'image/png', data: await toBase64(blob) };
  }
  throw new Error('Ảnh quá lớn sau khi thu nhỏ. Hãy chọn ảnh khác.');
}
