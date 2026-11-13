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
`rows_from_lines()` **不再硬编码版式**：链接与数字是否同行、千分位、合计行、
列顺序都由应用「工具配置 → OCR 截图版式」注入 `--layout <json>` 决定。
宿主会在调用时自动追加该参数，用户配置 `vision.paddleArgs` 时不要手写 --layout。
PaddleOCR 3.x 与 2.x 的返回结构都做了兼容；若本机 API 另有差异，只改
`recognize()` 一处即可。识别结果会回填成可编辑表格，**生成前请人工校对**。

本机自查（在 Anaconda 环境执行，把结果填入工具配置）：
    where python
    python -c "import sys,paddle,paddleocr; print(sys.executable); print('paddle',paddle.__version__); print('paddleocr',paddleocr.__version__)"
    python paddleocr_adapter.py <一张真实截图.png> --self-check  # 见生成页「自查命令」
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys

URL_RE = re.compile(r"https?://[^\s,;，；|]+", re.IGNORECASE)
# 千分位数字优先整体匹配，避免「12,40」两列被拼成 1240、「1,234」被切成 1 和 234
NUM_THOUSANDS_RE = re.compile(r"(?<![\w.])(?:\d{1,3}(?:,\d{3})+|\d+)(?![\w])")
NUM_PLAIN_RE = re.compile(r"(?<![\w.])\d+(?![\w])")


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


DEFAULT_LAYOUT = {
    "linkNumberSameLine": True,
    "thousandsSeparator": True,
    "skipTotalRow": True,
    "skipKeywords": "合计,总计,小计,total,sum",
    "columnOrder": "url,clicks,totalClicks",
}
URL_COLUMNS = {"url", "链接", "link", "href", "地址"}


def load_layout(raw: str) -> dict:
    """版式来自应用「工具配置 → OCR 截图版式」，宿主用 --layout 注入；不猜用户机器。"""
    layout = dict(DEFAULT_LAYOUT)
    if raw:
        try:
            layout.update(json.loads(raw))
        except (ValueError, TypeError) as err:
            print(f"--layout 解析失败，使用默认版式: {err}", file=sys.stderr)
    return layout


def _numbers(text: str, thousands: bool = True) -> list[int]:
    out: list[int] = []
    pattern = NUM_THOUSANDS_RE if thousands else NUM_PLAIN_RE
    for match in pattern.finditer(text):
        token = match.group(0)
        try:
            out.append(int(token.replace(",", "") if thousands else token))
        except ValueError:
            continue
    return out


def rows_from_lines(lines: list[str], layout: dict | None = None):
    """按配置配对 URL 与数值列；返回 (行列表, 数值列名列表)。"""
    cfg = layout or DEFAULT_LAYOUT
    skip_words = [
        w.strip().lower()
        for w in str(cfg.get("skipKeywords", "")).replace("，", ",").split(",")
        if w.strip()
    ]
    columns = [
        c.strip()
        for c in str(cfg.get("columnOrder", "url,clicks,totalClicks")).replace("，", ",").split(",")
        if c.strip()
    ]
    num_columns = [c for c in columns if c.lower() not in URL_COLUMNS]
    if "clicks" not in num_columns:
        num_columns.insert(0, "clicks")  # 宿主 parseCsvText 必须有 clicks 表头
    thousands = bool(cfg.get("thousandsSeparator", True))
    same_line = bool(cfg.get("linkNumberSameLine", True))

    dedup: dict[str, dict[str, int]] = {}
    for idx, line in enumerate(lines):
        if cfg.get("skipTotalRow") and any(w in line.lower() for w in skip_words):
            continue
        for url in URL_RE.findall(line):
            clean = url.rstrip(".,;:)>】」）")
            nums = _numbers(line.replace(clean, ""), thousands) if same_line else []
            if not nums and idx + 1 < len(lines):
                nums = _numbers(lines[idx + 1], thousands)
            if not nums:
                continue
            values = {
                col: nums[pos] if pos < len(nums) else (nums[-1] if col == "clicks" else 0)
                for pos, col in enumerate(num_columns)
            }
            dedup[clean] = values  # OCR 可能重复识别同一链接，保留最后一次
    return list(dedup.items()), num_columns


def main() -> int:
    parser = argparse.ArgumentParser(description="PaddleOCR -> Badge Studio 标准 CSV")
    parser.add_argument("image", nargs="?", help="截图绝对路径")
    parser.add_argument("--layout", default="", help="应用注入的 OCR 版式 JSON")
    parser.add_argument("--self-check", action="store_true", help="打印 Python / Paddle / PaddleOCR 版本")
    args = parser.parse_args()

    if args.self_check:
        import paddle
        import paddleocr
        print(f"python={sys.executable}")
        print(f"paddle={getattr(paddle, '__version__', 'unknown')}")
        print(f"paddleocr={getattr(paddleocr, '__version__', 'unknown')}")
        return 0
    if not args.image:
        parser.error("需要图片路径，或使用 --self-check")

    layout = load_layout(args.layout)
    lines = recognize(args.image)
    rows, num_columns = rows_from_lines(lines, layout)
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(["url", *num_columns])
    for url, values in rows:
        writer.writerow([url, *[values.get(col, values.get("clicks", 0)) for col in num_columns]])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
