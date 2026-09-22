/**
 * NIPPT 实验照片：独立上传 / 删除 / 历史 base64 迁移。
 *
 * 背景：原先照片以 base64 内联在批次 JSON 的 photos_female / photos_male 里，
 * 每次「保存全部」都要重传全部照片（10 张 ≈ 3MB）。跨境弱网下会超过 axios 超时
 * 导致上传中断（nginx 400），前端误报「保存失败」。
 *
 * 现在照片压缩后【立即上传】，列表里只存 URL（/media/...），保存请求体降到几 KB。
 * 历史 base64 照片在打开批次时后台迁移为 URL（文件名用内容 MD5，天然幂等去重）。
 */
import { casesApi } from "../api";

export type NipptPhotoModule = "preprocessing" | "extraction" | "library";
export type NipptPhotoSide = "f" | "m";

/** dataURL → File（供 multipart 上传） */
export const dataUrlToFile = (dataUrl: string, filename = "photo.jpg"): File => {
  const [head, body] = String(dataUrl).split(",");
  const mime = /:(.*?);/.exec(head || "")?.[1] || "image/jpeg";
  const bin = atob(body || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
  return new File([bytes], filename.replace(/\.\w+$/, "") + ext, { type: mime });
};

/** 是否已是服务端 URL（非 base64）。只有 URL 才有对应的磁盘文件可删。 */
export const isRemotePhoto = (s?: string): boolean => !!s && !s.startsWith("data:");

/** 上传一张照片（接受 dataURL 或 File），返回服务端 URL。失败会抛错，由调用方提示。 */
export const uploadNipptPhoto = async (
  module: NipptPhotoModule,
  batchId: string,
  side: NipptPhotoSide,
  src: string | File | Blob,
): Promise<string> => {
  const file = typeof src === "string" ? dataUrlToFile(src) : src instanceof File ? src : new File([src], "photo.jpg", { type: src.type || "image/jpeg" });
  const { data } = await (casesApi as any).uploadNipptPhoto(module, batchId, side, file);
  return data.url as string;
};

/** 删除一张已上传的照片。base64 照片无文件可删；失败静默（不阻塞 UI）。 */
export const deleteNipptPhoto = (
  module: NipptPhotoModule,
  batchId: string | undefined,
  side: NipptPhotoSide,
  url: string,
): void => {
  if (!batchId || !isRemotePhoto(url)) return;
  const name = url.split("?")[0].split("/").pop() || "";
  if (!name) return;
  (casesApi as any).deleteNipptPhoto(module, batchId, side, name).catch(() => {
    /* 静默：文件删除失败不影响用户操作 */
  });
};

/**
 * 把历史 base64 照片迁移为 URL（幂等：内容相同 → 同一个文件，不产生垃圾）。
 * 返回 true 表示发生过迁移。失败的单张保持 base64，不阻断其余迁移。
 */
export const migrateLegacyNipptPhotos = async (
  module: NipptPhotoModule,
  batchId: string | undefined,
  side: NipptPhotoSide,
  list: string[],
  apply: (next: string[]) => void,
): Promise<boolean> => {
  if (!batchId || !Array.isArray(list)) return false;
  if (!list.some((x) => typeof x === "string" && x.startsWith("data:"))) return false;

  const out = [...list];
  let changed = false;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]?.startsWith("data:")) continue;
    try {
      out[i] = await uploadNipptPhoto(module, batchId, side, out[i]);
      changed = true;
    } catch {
      /* 保持 base64，下次再试 */
    }
  }
  if (changed) apply(out);
  return changed;
};
