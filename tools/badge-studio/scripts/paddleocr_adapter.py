#!/usr/bin/env python3
"""PaddleOCR -> Badge Studio 标准 CSV 的参考适配器（本机图片数据源）。

用途
----
把「链接 + 点击数」的截图 / 表格图片识别成带表头的 CSV，交给
`core/vision.ts::parseVisionResult` 统一转成 StatRow[]，再走原有
URL 归一 + badge 注入链路。云端视觉模型与本机 OCR 输出同一种结构。

配置（工具配置 → 图片识别）
--------------------------
vision.provider       = paddleocr
vision.paddleCommand  = <本机 Anaconda python.exe 绝对路径>
vision.paddleArgs     = <本文件绝对路径> {image}
    例如 Windows：
    "D:/Anaconda3/python.exe"
    "D:/workspace/code/sshk-tools/tools/badge-studio/scripts/paddleocr_adapter.py {image}"
    路径必须用绝对路径；打包后应用的工作目录不是仓库根目录。
    {image} 由宿主替换为用户所选图片的绝对路径，且不使用 shell，无注入风险。

输出
----
stdout 仅输出 CSV（首行表头），例如：
    url,clicks,totalClicks
    https://example.com/a,12,12

注意
----
这是**参考模板**：截图版式不同（多行链接、合并单元格、千分位、百分比列）
时请按实际版式调整 `rows_from_lines`。PaddleOCR 3.x 与 2.x 的返回结构
都做了兼容；若本机 API 另有差异，只改 `recognize()` 一处即可。
识别结果在 Badge Studio 里会回填成可编辑 CSV，**生成前请人工校对**。
"""

from __future__ import annotations

import csv
import re
import sys

URL_RE = re.compile(r"https?://[^\s,;，；|]+", re.IGNORECASE)
NUM_RE = re.compile(r"(?<![\w.])(\d[\d,]*)(?![\w])")


def recognize(image_path: str) -> list[str]:
    """返回按阅读顺序排列的识别文本行。"""
    from paddleocr import PaddleOCR  # 延迟导入：导入失败时错误更清晰

    try:  # PaddleOCR 3.x
        engine = PaddleOCR(
            lang="ch",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
        result = engine.predict(image_path)
        lines: list[str] = []
        for page in result:
            texts = getattr(page, "get", lambda *_: None)("rec_texts")
            if texts:
                lines.extend(str(t).strip() for t in texts)
            elif isinstance(page, dict) and page.get("rec_texts"):
                lines.extend(str(t).strip() for t in page["rec_texts"])
        return [line for line in lines if line]
    except TypeError:  # PaddleOCR 2.x
        engine = PaddleOCR(use_angle_cls=True, lang="ch")
        result = engine.ocr(image_path, cls=True)
        lines = []
        for page in result or []:
            for item in page or []:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    text = item[1]
                    lines.append(str(text[0] if isinstance(text, (list, tuple)) else text).strip())
        return [line for line in lines if line]


def _numbers(text: str) -> list[int]:
    return [int(m.group(1).replace(",", "")) for m in NUM_RE.finditer(text)]


def rows_from_lines(lines: list[str]) -> list[tuple[str, int]]:
    """从识别文本里配对 URL 与点击数；同行没数字时看下一行第一个数字。"""
    rows: list[tuple[str, int]] = []
    for idx, line in enumerate(lines):
        for url in URL_RE.findall(line):
            clean = url.rstrip(".,;:)>】」）")
            nums = _numbers(line.replace(clean, ""))
            if not nums and idx + 1 < len(lines):
                nums = _numbers(lines[idx + 1])
            clicks = nums[-1] if nums else 0
            rows.append((clean, clicks))
    # 同一个链接可能被 OCR 重复识别，保留最后一次
    dedup: dict[str, int] = {}
    for url, clicks in rows:
        dedup[url] = clicks
    return list(dedup.items())


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: paddleocr_adapter.py <image>", file=sys.stderr)
        return 2
    lines = recognize(sys.argv[1])
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(["url", "clicks", "totalClicks"])
    for url, clicks in rows_from_lines(lines):
        writer.writerow([url, clicks, clicks])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
