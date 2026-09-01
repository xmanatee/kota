import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";
import { useState } from "react";
import type { UiNode } from "../../../../conformance/ui-surface.generated";
import { searchItems, searchItemsValue } from "../../../../shared/search-state";
import { SharedUiAction } from "./SharedUiAction";
import { roleClass, rowActionDefaults } from "./ui-render-utils";

type TableNode = Extract<UiNode, { kind: "table" }>;
type TableRow = TableNode["rows"][number];

export function SharedUiTable({ node }: { node: TableNode }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterableColumns = node.columns.filter((column) => column.filterable);
  const filterOptions = Object.fromEntries(
    filterableColumns.map((column) => [
      column.id,
      [
        ...new Set(
          node.rows.map((row) => cellValue(row, column.id)).filter(Boolean),
        ),
      ].sort(),
    ]),
  );
  const search = searchItems(
    node.rows,
    query,
    (row) => row.cells.map((cell) => cell.value),
    filterableColumns.map((column) => ({
      value: filters[column.id] ?? "",
      matches: (row, selected) => cellValue(row, column.id) === selected,
    })),
  );
  const visibleRows = searchItemsValue(search);
  const hasActiveFilters = search.status !== "idle";
  const showControls = node.searchable === true || filterableColumns.length > 0;

  const clearFilters = () => {
    setQuery("");
    setFilters({});
  };

  return (
    <div className="flex flex-col gap-2">
      {showControls ? (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={`${node.title} filters`}
        >
          {node.searchable ? (
            <div className="relative min-w-44 flex-1 sm:max-w-60">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={`Search ${node.title.toLowerCase()}`}
                aria-label={`Search ${node.title}`}
                className="h-8 pl-8 text-sm"
              />
            </div>
          ) : null}
          {filterableColumns.map((column) => (
            <div key={column.id}>
              <Select
                value={filters[column.id] ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFilters((current) => ({
                    ...current,
                    [column.id]: value,
                  }));
                }}
                aria-label={`Filter by ${column.label}`}
                className="h-8 min-w-32 py-1 text-sm"
              >
                <option value="">All {column.label.toLowerCase()}</option>
                {filterOptions[column.id]?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={clearFilters}
              aria-label="Clear filters"
              title="Clear filters"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {visibleRows.length}/{node.rows.length}
          </span>
        </div>
      ) : null}

      {search.status === "empty" || node.rows.length === 0 ? (
        <div className="border-y border-border px-3 py-8 text-center text-sm text-muted-foreground">
          {node.rows.length === 0 ? "No records." : "No matching records."}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <caption className="sr-only">{node.title}</caption>
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  {node.columns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      className="px-3 py-2 font-medium"
                    >
                      {column.label}
                    </th>
                  ))}
                  {node.rows.some((row) => row.action) ? (
                    <th scope="col" className="w-40 px-3 py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    {node.columns.map((column, index) => {
                      const cell = row.cells.find(
                        (candidate) => candidate.columnId === column.id,
                      );
                      return (
                        <td
                          key={column.id}
                          className={cn(
                            "max-w-[32rem] break-words px-3 py-2 align-top",
                            index === 0 && "font-medium text-foreground",
                            roleClass(cell?.role ?? column.role),
                          )}
                        >
                          {cell?.value ?? ""}
                        </td>
                      );
                    })}
                    {node.rows.some((candidate) => candidate.action) ? (
                      <td className="px-3 py-2 align-top">
                        <RowAction row={row} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-border border-y border-border sm:hidden">
            {visibleRows.map((row) => {
              const primary = row.cells.find(
                (cell) => cell.columnId === node.columns[0]?.id,
              );
              return (
                <li key={row.id} className="flex flex-col gap-2 py-3">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      roleClass(primary?.role),
                    )}
                  >
                    {primary?.value ?? row.id}
                  </p>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {node.columns.slice(1).map((column) => {
                      const cell = row.cells.find(
                        (candidate) => candidate.columnId === column.id,
                      );
                      if (!cell?.value || cell.value === "—") return null;
                      return (
                        <div key={column.id} className="flex min-w-0 gap-1.5">
                          <dt className="text-muted-foreground">
                            {column.label}
                          </dt>
                          <dd
                            className={cn(
                              "break-words",
                              roleClass(cell.role ?? column.role),
                            )}
                          >
                            {cell.value}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <RowAction row={row} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function cellValue(row: TableRow, columnId: string): string {
  return row.cells.find((cell) => cell.columnId === columnId)?.value ?? "";
}

function RowAction({ row }: { row: TableRow }) {
  if (!row.action) return null;
  return (
    <SharedUiAction
      action={row.action}
      initialParameters={rowActionDefaults(row.action, row.id)}
    />
  );
}
