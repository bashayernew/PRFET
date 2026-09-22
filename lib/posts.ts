import { apiPost } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

export type PostUser = { id: string; displayName: string; avatarUrl: string | null; category: string | null; bio?: string | null; isPremium?: boolean; textColor?: string | null };

export type FeedPost = {
  id: string;
  userId: string;
  kind: string; // image | video
  mediaUrl: string;
  caption: string | null;
  views: number;
  allowRepost: boolean;
  allowSave: boolean;
  allowComment: boolean;
  likes: number;
  comments: number;
  reposts: number;
  likedByMe: boolean;
  mine: boolean;
  repostOf: { id: string; user: PostUser } | null;
  createdAt: string;
  user: PostUser;
};

export type PostComment = {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; displayName: string; avatarUrl: string | null; isPremium?: boolean; textColor?: string | null };
  mine: boolean;
  /** The comment this one answers, or null for a top-level comment. Nesting is unlimited. */
  parentId?: string | null;
  likes?: number;
  liked?: boolean;
};

/** Like / unlike a comment. One toggle endpoint, so the button can't get out of step. */
export async function toggleCommentLike(commentId: string, token?: string) {
  return apiPost<{ liked: boolean; likes: number }>(`/api/comments/${commentId}/like`, {}, token);
}

export async function toggleLike(id: string, token?: string) {
  return apiPost<{ liked: boolean; likes: number }>(`/api/posts/${id}/like`, {}, token);
}

export async function repostPost(id: string, token?: string) {
  return apiPost<{ id: string; already?: boolean }>(`/api/posts/${id}/repost`, {}, token);
}

export function postLink(id: string) {
  const origin = typeof location !== "undefined" ? location.origin : "https://prfet.com";
  return `${origin}/post/${id}`;
}

/** "5د" / "5m" style relative time. */
export function timeAgo(iso: string, locale: Locale) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const digits = (n: number) => (locale === "ar" ? n.toLocaleString("ar-EG") : String(n));
  if (s < 60) return locale === "ar" ? "الآن" : "now";
  const m = Math.floor(s / 60);
  if (m < 60) return locale === "ar" ? `قبل ${digits(m)} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return locale === "ar" ? `قبل ${digits(h)} س` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return locale === "ar" ? `قبل ${digits(d)} ي` : `${d}d ago`;
  const w = Math.floor(d / 7);
  return locale === "ar" ? `قبل ${digits(w)} أ` : `${w}w ago`;
}

/** Download the media (only offered when the author allowed saving). */
export async function saveMedia(url: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = url.split("/").pop() || "herot";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch {
    return false;
  }
}
