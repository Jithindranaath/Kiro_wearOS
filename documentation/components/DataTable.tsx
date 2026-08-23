import type { ReactNode } from 'react';

interface DataTableProps {
  head: string[];
  rows: ReactNode[][];
  /** Optional caption rendered under the table. */
  caption?: string;
}

export function DataTable({ head, rows, caption }: DataTableProps) {
  return (
    <figure className="glass overflow-hidden rounded-2xl">
      <div className="overflow-x-auto">
        <table className="dtable">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && (
        <figcaption className="border-t border-white/[0.06] px-4 py-3 text-[11px] text-neutral-500">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
