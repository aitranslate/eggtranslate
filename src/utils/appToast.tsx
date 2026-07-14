/**
 * 应用 Toast 封装
 * - 宽度随内容收缩（短句不拉满），最长约 20rem
 * - 错误：右侧复制图标；点击本体可关闭（复制钮不关闭）
 */

import toast from 'react-hot-toast';
import { Copy, XCircle } from 'lucide-react';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 短文案贴内容收缩；长文案受 max-w 约束。
 * 文案区必须 min-w-0 + break-all，否则无空格的 request id 会把复制钮挤出白底。
 */
const shellClass =
  'inline-flex max-w-[min(20rem,calc(100vw-2rem))] items-start gap-2.5 px-3.5 py-2.5 ' +
  'bg-white shadow-lg rounded-xl border border-gray-200 pointer-events-auto cursor-pointer overflow-hidden';

/** 错误 Toast（默认 5s；点击本体关闭，复制钮 stopPropagation） */
export function toastError(message: string, options?: { duration?: number }) {
  return toast.custom(
    (t) => (
      <div
        className={`${shellClass} ${t.visible ? 'animate-enter' : 'animate-leave'}`}
        role="alert"
        title="点击关闭"
        onClick={() => toast.dismiss(t.id)}
      >
        <XCircle className="w-[18px] h-[18px] text-red-500 shrink-0 mt-0.5" />
        <p className="min-w-0 flex-1 text-sm text-gray-800 leading-snug break-all text-left">
          {message}
        </p>
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            const ok = await copyText(message);
            if (ok) {
              toast.success('已复制', { duration: 1200 });
            }
          }}
          className="shrink-0 self-center -mr-0.5 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          title="复制"
          aria-label="复制错误信息"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    ),
    { duration: options?.duration ?? 5000, position: 'top-right' }
  );
}
