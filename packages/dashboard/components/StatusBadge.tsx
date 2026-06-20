const COLORS: Record<string, string> = {
  drafted: "bg-gray-200 text-gray-800",
  reviewing: "bg-yellow-200 text-yellow-900",
  submitted: "bg-blue-200 text-blue-900",
  interviewed: "bg-green-200 text-green-900",
  rejected: "bg-red-200 text-red-900",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs ${COLORS[status] ?? COLORS.drafted}`}
    >
      {status}
    </span>
  );
}
