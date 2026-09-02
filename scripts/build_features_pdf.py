from __future__ import annotations

import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate,
    KeepTogether,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "FEATURES.md"
OUTPUT = ROOT / "output" / "pdf" / "MXGenius_Feature_Catalog_2026-08-31.pdf"

PAGE_W, PAGE_H = LETTER
NAVY = colors.HexColor("#060A1E")
PANEL = colors.HexColor("#111831")
PANEL_2 = colors.HexColor("#171F3C")
CYAN = colors.HexColor("#04E7C4")
BLUE = colors.HexColor("#34B7FF")
PURPLE = colors.HexColor("#9A7BFF")
ORANGE = colors.HexColor("#FF9B45")
RED = colors.HexColor("#FF666E")
INK = colors.HexColor("#11182A")
MUTED = colors.HexColor("#5F6981")
LIGHT = colors.HexColor("#F3F6FC")
LINE = colors.HexColor("#DDE4F0")
WHITE = colors.white


def register_fonts() -> None:
    font_dir = Path("C:/Windows/Fonts")
    candidates = {
        "MXRegular": font_dir / "segoeui.ttf",
        "MXBold": font_dir / "segoeuib.ttf",
        "MXSemibold": font_dir / "seguisb.ttf",
        "MXMono": font_dir / "consola.ttf",
    }
    for name, path in candidates.items():
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
    if "MXRegular" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("MXRegular", str(font_dir / "arial.ttf")))
        pdfmetrics.registerFont(TTFont("MXBold", str(font_dir / "arialbd.ttf")))
        pdfmetrics.registerFont(TTFont("MXSemibold", str(font_dir / "arialbd.ttf")))
        pdfmetrics.registerFont(TTFont("MXMono", str(font_dir / "consola.ttf")))


def normalize(text: str) -> str:
    return (
        text.replace("\u2011", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2192", "->")
    )


STATUS_COLORS = {
    "[x]": CYAN,
    "[~]": BLUE,
    "[!]": ORANGE,
    "[ ]": MUTED,
    "[-]": PURPLE,
}


def rich(text: str) -> str:
    safe = escape(normalize(text))
    safe = re.sub(r"`([^`]+)`", r'<font name="MXMono">\1</font>', safe)
    for token, color in STATUS_COLORS.items():
        safe = safe.replace(
            escape(f"`{token}`"),
            f'<font name="MXBold" color="{color.hexval()}">{escape(token)}</font>',
        )
        safe = safe.replace(
            escape(token),
            f'<font name="MXBold" color="{color.hexval()}">{escape(token)}</font>',
        )
    safe = re.sub(r"\*\*([^*]+)\*\*", r'<font name="MXBold">\1</font>', safe)
    return safe


def cover(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(CYAN)
    canvas.circle(PAGE_W - 0.55 * inch, PAGE_H - 0.52 * inch, 1.85 * inch, fill=0, stroke=1)
    canvas.setStrokeColor(colors.Color(0.02, 0.91, 0.77, alpha=0.34))
    canvas.setLineWidth(1.2)
    canvas.circle(PAGE_W - 0.55 * inch, PAGE_H - 0.52 * inch, 1.35 * inch, fill=0, stroke=1)
    canvas.setFillColor(CYAN)
    canvas.roundRect(0.72 * inch, PAGE_H - 1.13 * inch, 0.34 * inch, 0.34 * inch, 6, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("MXBold", 18)
    canvas.drawString(1.18 * inch, PAGE_H - 0.98 * inch, "MXGenius.io")
    canvas.setFillColor(colors.HexColor("#AAB6D0"))
    canvas.setFont("MXSemibold", 10)
    canvas.drawString(0.76 * inch, 0.70 * inch, "CONFIDENTIAL PRODUCT BRIEF  |  31 AUGUST 2026")
    canvas.restoreState()


def content_page(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFillColor(WHITE)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setStrokeColor(LINE)
    canvas.line(0.65 * inch, 0.48 * inch, PAGE_W - 0.65 * inch, 0.48 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("MXRegular", 8)
    canvas.drawString(0.66 * inch, 0.30 * inch, "Status reflects repository evidence and named external validation gates.")
    canvas.drawRightString(PAGE_W - 0.66 * inch, 0.30 * inch, f"{doc.page - 1:02d}")
    canvas.restoreState()


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker",
            parent=base["Normal"],
            fontName="MXSemibold",
            fontSize=10,
            leading=13,
            textColor=CYAN,
            spaceAfter=14,
            tracking=1.2,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName="MXBold",
            fontSize=40,
            leading=42,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=18,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontName="MXRegular",
            fontSize=14,
            leading=20,
            textColor=colors.HexColor("#B9C4DA"),
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="MXBold",
            fontSize=22,
            leading=27,
            textColor=NAVY,
            spaceBefore=4,
            spaceAfter=12,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="MXBold",
            fontSize=15.5,
            leading=20,
            textColor=NAVY,
            spaceBefore=12,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Heading3"],
            fontName="MXSemibold",
            fontSize=11.5,
            leading=15,
            textColor=PURPLE,
            spaceBefore=8,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="MXRegular",
            fontSize=9.2,
            leading=13.2,
            textColor=INK,
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="MXRegular",
            fontSize=8.2,
            leading=11.2,
            textColor=MUTED,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["BodyText"],
            fontName="MXRegular",
            fontSize=8.7,
            leading=12.2,
            leftIndent=13,
            firstLineIndent=-10,
            bulletIndent=1,
            textColor=INK,
            spaceAfter=3.2,
        ),
        "feature": ParagraphStyle(
            "feature",
            parent=base["BodyText"],
            fontName="MXRegular",
            fontSize=8.7,
            leading=12.2,
            textColor=INK,
        ),
        "audit_title": ParagraphStyle(
            "audit_title",
            parent=base["Heading2"],
            fontName="MXBold",
            fontSize=12,
            leading=15,
            textColor=WHITE,
            spaceAfter=4,
        ),
        "audit_body": ParagraphStyle(
            "audit_body",
            parent=base["BodyText"],
            fontName="MXRegular",
            fontSize=8.7,
            leading=12.2,
            textColor=colors.HexColor("#D9E2F1"),
        ),
        "metric": ParagraphStyle(
            "metric",
            parent=base["Normal"],
            fontName="MXBold",
            fontSize=19,
            leading=21,
            alignment=TA_CENTER,
            textColor=NAVY,
        ),
        "metric_label": ParagraphStyle(
            "metric_label",
            parent=base["Normal"],
            fontName="MXSemibold",
            fontSize=7.4,
            leading=9.2,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
    }


def audit_panel(title: str, body: str, st) -> Table:
    panel = Table(
        [[Paragraph(title, st["audit_title"])], [Paragraph(body, st["audit_body"])]],
        colWidths=[6.8 * inch],
        hAlign="LEFT",
    )
    panel.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#263457")),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, 0), 12),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
                ("TOPPADDING", (0, 1), (-1, 1), 2),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 13),
            ]
        )
    )
    return panel


def markdown_table(rows: list[list[str]], st) -> Table:
    if not rows:
        raise ValueError("empty table")
    width = 6.8 * inch
    if len(rows[0]) == 3:
        col_widths = [2.05 * inch, 0.62 * inch, 4.13 * inch]
    elif len(rows[0]) == 2:
        col_widths = [1.1 * inch, width - 1.1 * inch]
    else:
        col_widths = [width / len(rows[0])] * len(rows[0])
    data = []
    for ridx, row in enumerate(rows):
        style = ParagraphStyle(
            f"tbl-{ridx}",
            parent=st["small"],
            fontName="MXSemibold" if ridx == 0 else "MXRegular",
            fontSize=8.0,
            leading=10.5,
            textColor=WHITE if ridx == 0 else INK,
        )
        data.append([Paragraph(rich(cell), style) for cell in row])
    table = Table(data, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def parse_catalog(lines: list[str], st) -> list:
    story: list = []
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line or line.startswith("# MXGenius feature catalog") or line.startswith("Last updated:"):
            i += 1
            continue
        if line.startswith("## "):
            if line[3:] == "Product surface summary":
                story.append(PageBreak())
            story.append(Paragraph(rich(line[3:]), st["h2"]))
        elif line.startswith("### "):
            story.append(Paragraph(rich(line[4:]), st["h3"]))
        elif line.startswith("| "):
            rows: list[list[str]] = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            story.append(markdown_table(rows, st))
            story.append(Spacer(1, 8))
            continue
        elif re.match(r"^- ", line):
            body = line[2:]
            story.append(Paragraph(f"- {rich(body)}", st["bullet"]))
        elif re.match(r"^\d+\. ", line):
            number, body = line.split(". ", 1)
            story.append(Paragraph(f"{number}. {rich(body)}", st["bullet"]))
        else:
            story.append(Paragraph(rich(line), st["body"]))
        i += 1
    return story


def paginate_flowables(flowables: list, max_height: float = 560) -> list:
    """Insert deterministic page breaks before Platypus has to split a frame."""
    paginated: list = []
    used = 0.0
    available_width = 7.0 * inch
    for index, flowable in enumerate(flowables):
        if isinstance(flowable, PageBreak):
            paginated.append(flowable)
            paginated.append(Spacer(1, 0.42 * inch))
            used = 0.42 * inch
            continue
        _, height = flowable.wrap(available_width, max_height)
        height += float(flowable.getSpaceBefore() or 0) + float(flowable.getSpaceAfter() or 0)
        if getattr(flowable, "keepWithNext", False) and index + 1 < len(flowables):
            next_flowable = flowables[index + 1]
            if not isinstance(next_flowable, PageBreak):
                _, next_height = next_flowable.wrap(available_width, max_height)
                height += next_height + float(next_flowable.getSpaceBefore() or 0)
        if used and used + height > max_height:
            paginated.append(PageBreak())
            paginated.append(Spacer(1, 0.42 * inch))
            used = 0.42 * inch
        paginated.append(flowable)
        used += height
    return paginated


def feature_bullet(body: str, st, in_production: bool = False) -> Table:
    marker = Table([[""]], colWidths=[5], rowHeights=[5])
    marker.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLUE if in_production else CYAN),
                ("BOX", (0, 0), (-1, -1), 0, BLUE if in_production else CYAN),
            ]
        )
    )
    note = ""
    if in_production:
        note = ' &nbsp; <font name="MXSemibold" color="#1584C5">IN PRODUCTION</font>'
    row = Table(
        [[marker, Paragraph(f"{rich(body)}{note}", st["feature"])]],
        colWidths=[0.15 * inch, 6.65 * inch],
        hAlign="LEFT",
    )
    row.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (0, 0), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    row.spaceAfter = 3.2
    return row


def parse_sendable_catalog(lines: list[str], st) -> list:
    """Create an external bullet list with only implemented and in-production features."""
    story: list = []
    section_enabled = False
    boundaries = False
    pending_subheading: str | None = None
    for raw_line in lines:
        line = raw_line.rstrip()
        if line.startswith("## Maintaining this catalog"):
            break
        if line.startswith("## "):
            title = line[3:]
            if title in {"Status legend", "Product surface summary"}:
                section_enabled = False
                boundaries = False
                pending_subheading = None
                continue
            if re.match(r"^\d+\. ", title):
                section_enabled = True
                boundaries = title.startswith("14. ")
                if boundaries:
                    title = "Product guardrails"
                    # Keep the external-facing guardrails together as a coherent
                    # final page instead of splitting the list across pages.
                    story.append(PageBreak())
                story.append(Paragraph(rich(title), st["h2"]))
                pending_subheading = None
            else:
                section_enabled = False
            continue
        if not section_enabled or not line:
            continue
        if line.startswith("### "):
            pending_subheading = line[4:]
            continue
        status_match = re.match(r"^- `(?P<status>\[[x~! -]\])` (?P<body>.+)$", line)
        if status_match:
            status = status_match.group("status")
            body = status_match.group("body")
            if status == "[x]":
                if pending_subheading:
                    story.append(Paragraph(rich(pending_subheading), st["h3"]))
                    pending_subheading = None
                story.append(feature_bullet(body, st))
            elif status == "[~]":
                if body.startswith((
                    "Production XR negotiation",
                    "Hardware-dependent and external-adapter gates",
                )):
                    continue
                if pending_subheading:
                    story.append(Paragraph(rich(pending_subheading), st["h3"]))
                    pending_subheading = None
                story.append(feature_bullet(body, st, in_production=True))
            continue
        if boundaries and line.startswith("- "):
            story.append(feature_bullet(line[2:], st))
    return story


def build() -> None:
    register_fonts()
    text = normalize(SOURCE.read_text(encoding="utf-8"))
    lines = text.splitlines()
    st = styles()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=LETTER,
        leftMargin=0.66 * inch,
        rightMargin=0.66 * inch,
        topMargin=0.72 * inch,
        bottomMargin=0.64 * inch,
        title="MXGenius Feature Catalog",
        author="MXGenius.io",
        subject="External product capability catalog",
    )
    story = [
        Spacer(1, 3.74 * inch),
        Paragraph("PRODUCT CAPABILITY CATALOG", st["cover_kicker"]),
        Paragraph("Feature<br/>Catalog", st["cover_title"]),
        Paragraph(
            "A concise external inventory of implemented and mounted product capabilities.",
            st["cover_sub"],
        ),
        Spacer(1, 0.38 * inch),
        Table(
            [[Paragraph("FEATURES", st["audit_title"]), Paragraph("SEND-READY", st["audit_title"])]],
            colWidths=[1.55 * inch, 1.85 * inch],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#173A47")),
                    ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#24345B")),
                    ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#325071")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.8, colors.HexColor("#325071")),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            ),
        ),
        PageBreak(),
        Spacer(1, 0.42 * inch),
        Paragraph("Feature catalog", st["h1"]),
        Paragraph(
            "Bullets without a note are implemented and covered by repository verification. Items marked IN PRODUCTION are materially mounted but still completing a deployment, data, device, or field-acceptance gate.",
            st["body"],
        ),
    ]
    story.extend(paginate_flowables(parse_sendable_catalog(lines, st)))
    doc.build(story, onFirstPage=cover, onLaterPages=content_page)
    print(OUTPUT)


if __name__ == "__main__":
    build()
