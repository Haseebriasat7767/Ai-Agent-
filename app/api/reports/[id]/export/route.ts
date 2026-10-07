import { NextResponse } from "next/server";
import { apiError, authorize, handleRouteError } from "@/lib/auth/guards";
import { getReport } from "@/lib/repo/reports";
import { reportToDocx, reportToMarkdown, reportToPdf, toCsv } from "@/lib/export/documents";
import { logActivity } from "@/lib/repo/activity";
import { slugify } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const format = (new URL(request.url).searchParams.get("format") || "md").toLowerCase();
    const report = await getReport(guard.auth.user.id, id);
    if (!report) return apiError(404, "not_found", "Report not found.");
    const base = slugify(report.title, "report");

    if (format === "pdf") {
      const bytes = await reportToPdf(report);
      await logActivity(guard.auth.user.id, { type: "report", status: "success", title: `Exported report as PDF: ${report.title}`, detail: { reportId: report.id } });
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${base}.pdf"`,
          "cache-control": "private, no-store",
        },
      });
    }

    if (format === "docx") {
      const buffer = await reportToDocx(report);
      await logActivity(guard.auth.user.id, { type: "report", status: "success", title: `Exported report as DOCX: ${report.title}`, detail: { reportId: report.id } });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename="${base}.docx"`,
          "cache-control": "private, no-store",
        },
      });
    }

    if (format === "csv") {
      const data = report.data;
      let rows: Array<Record<string, unknown>> = [];
      if (Array.isArray(data)) rows = data as Array<Record<string, unknown>>;
      else if (data && typeof data === "object") {
        const candidate = Object.values(data).find((value) => Array.isArray(value));
        if (Array.isArray(candidate)) rows = candidate as Array<Record<string, unknown>>;
        else rows = [data as Record<string, unknown>];
      }
      if (rows.length === 0) {
        return apiError(409, "no_tabular_data", "This report has no tabular data to export as CSV.", {
          hint: "Ask the assistant to regenerate the report with a `data` table, or export as PDF/DOCX instead.",
        });
      }
      return new NextResponse(toCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${base}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    }

    return new NextResponse(reportToMarkdown(report), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.md"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "report-export");
  }
}
