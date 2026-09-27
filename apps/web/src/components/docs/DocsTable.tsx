import type { ReactNode } from "react";

// Hairline-bordered table, horizontally scrollable within its own box (never
// the page) so a wide row can't force overflow at phone width.
export function DocsTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium text-fg-subtle">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-top text-fg-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
