"use client";
export function PdfCompiler({ latex }: { latex: string }) {
  return (
    <div className="text-xs text-gray-500">
      PDF compiler loads in Task 4.6. ({latex.length} chars of LaTeX)
    </div>
  );
}
