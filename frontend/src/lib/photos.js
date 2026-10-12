// Shrinking a photo of an order form before it is uploaded. Phone cameras take
// 3-8 MB pictures; the free database holds 512 MB for everything, so each one
// is cut to a few hundred KB here - still sharp enough to read handwriting.

const TARGET_BYTES = 450_000; // the server refuses anything over 700 KB
// tried in order until one fits
const STEPS = [
  { side: 1600, quality: 0.72 },
  { side: 1280, quality: 0.62 },
  { side: 1024, quality: 0.55 },
];

const decode = async (file) => {
  // createImageBitmap applies the camera's rotation, so a portrait shot is not
  // stored on its side. The <img> route is for browsers without it.
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const toJpeg = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/** A file the user picked -> { data (base64 JPEG), url (to preview), size }. Throws a readable Error. */
export async function shrinkPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error(`"${file.name}" is not a photo`);
  let img;
  try {
    img = await decode(file);
  } catch {
    throw new Error(`"${file.name}" could not be opened - try taking the photo again`);
  }
  const w = img.width;
  const h = img.height;
  let blob = null;
  for (const step of STEPS) {
    const scale = Math.min(1, step.side / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    // white under a transparent PNG, rather than black
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    blob = await toJpeg(canvas, step.quality);
    if (blob && blob.size <= TARGET_BYTES) break;
  }
  if (img.close) img.close();
  if (!blob) throw new Error(`"${file.name}" could not be prepared`);
  return { data: await toBase64(blob), url: URL.createObjectURL(blob), size: blob.size };
}

export const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
