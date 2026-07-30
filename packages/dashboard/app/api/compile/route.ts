import {
  compileLatex,
  TectonicMissingError,
} from "../../../../../lib/local/compile-latex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let latex: unknown;
  try {
    ({ latex } = await req.json());
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof latex !== "string" || latex.trim().length === 0) {
    return Response.json(
      { error: "latex (non-empty string) required" },
      { status: 400 },
    );
  }

  try {
    const pdf = await compileLatex(latex);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
  } catch (err) {
    if (err instanceof TectonicMissingError) {
      return Response.json(
        { error: err.message, hint: "brew install tectonic" },
        { status: 503 },
      );
    }
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
