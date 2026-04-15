import { api } from "@/api/client";
import { queryKeys, tasksQuery } from "@/api/queries";
import type { DaemonTaskDetail } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renderMarkdown } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

const TASK_GROUPS = [
  { state: "doing", label: "Doing", variant: "running" as const },
  { state: "ready", label: "Ready", variant: "success" as const },
  { state: "blocked", label: "Blocked", variant: "warning" as const },
  { state: "backlog", label: "Backlog", variant: "secondary" as const },
] as const;

const TASK_ACTIONS: Record<
  string,
  Array<{ label: string; state: string; danger?: boolean }>
> = {
  ready: [
    { label: "\u2193 Backlog", state: "backlog" },
    { label: "\u2715 Drop", state: "dropped", danger: true },
  ],
  backlog: [
    { label: "\u2191 Ready", state: "ready" },
    { label: "\u2715 Drop", state: "dropped", danger: true },
  ],
  blocked: [
    { label: "\u2191 Ready", state: "ready" },
    { label: "\u2193 Backlog", state: "backlog" },
    { label: "\u2715 Drop", state: "dropped", danger: true },
  ],
};

export function TaskPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery(tasksQuery);
  const tasks = data?.tasks;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [editBody, setEditBody] = useState<Record<string, string>>({});

  const moveMutation = useMutation({
    mutationFn: ({ id, state }: { id: string; state: string }) =>
      api.moveTask(id, state),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.updateTaskBody(id, body),
    onSuccess: (_data, vars) => {
      setEditing((e) => ({ ...e, [vars.id]: false }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ title, summary }: { title: string; summary: string }) =>
      api.createTask(title, summary),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = (
      form.elements.namedItem("title") as HTMLInputElement
    ).value.trim();
    const summary = (
      form.elements.namedItem("summary") as HTMLInputElement
    ).value.trim();
    if (!title) return;
    createMutation.mutate({ title, summary });
    form.reset();
  }

  return (
    <div className="space-y-1">
      {TASK_GROUPS.map((group) => {
        const items = (tasks?.[group.state as keyof typeof tasks] ??
          []) as DaemonTaskDetail[];
        if (items.length === 0) return null;
        const isCollapsed = collapsed[group.state];
        return (
          <div key={group.state}>
            <button
              type="button"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [group.state]: !c[group.state] }))
              }
              className="flex w-full items-center gap-1.5 py-1 text-xs font-medium hover:text-foreground"
            >
              <Badge variant={group.variant} className="h-4 px-1.5 text-[10px]">
                {items.length}
              </Badge>
              <span>{group.label}</span>
              <span className="ml-auto text-muted-foreground">
                {isCollapsed ? "\u25B8" : "\u25BE"}
              </span>
            </button>
            {!isCollapsed &&
              items.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  groupState={group.state}
                  isExpanded={!!expanded[t.id]}
                  isEditing={!!editing[t.id]}
                  editBody={editBody[t.id] ?? t.body}
                  onToggle={() => {
                    setExpanded((e) => ({ ...e, [t.id]: !e[t.id] }));
                    if (expanded[t.id])
                      setEditing((e) => ({ ...e, [t.id]: false }));
                  }}
                  onMove={(state) => moveMutation.mutate({ id: t.id, state })}
                  onStartEdit={() => {
                    setEditBody((b) => ({ ...b, [t.id]: t.body }));
                    setEditing((e) => ({ ...e, [t.id]: true }));
                  }}
                  onCancelEdit={() =>
                    setEditing((e) => ({ ...e, [t.id]: false }))
                  }
                  onSave={() =>
                    saveMutation.mutate({
                      id: t.id,
                      body: editBody[t.id] ?? t.body,
                    })
                  }
                  onEditChange={(val) =>
                    setEditBody((b) => ({ ...b, [t.id]: val }))
                  }
                />
              ))}
          </div>
        );
      })}
      {!tasks ||
      Object.values(tasks).every(
        (arr) => (arr as DaemonTaskDetail[]).length === 0,
      ) ? (
        <div className="text-xs text-muted-foreground">No open tasks</div>
      ) : null}
      <form onSubmit={handleCreate} className="space-y-1 pt-1">
        <Input
          name="title"
          placeholder="New task title..."
          className="h-7 text-xs"
        />
        <div className="flex gap-1">
          <Input
            name="summary"
            placeholder="Summary (optional)"
            className="h-7 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
          >
            + Add
          </Button>
        </div>
      </form>
    </div>
  );
}

function TaskItem({
  task,
  groupState,
  isExpanded,
  isEditing,
  editBody,
  onToggle,
  onMove,
  onStartEdit,
  onCancelEdit,
  onSave,
  onEditChange,
}: {
  task: DaemonTaskDetail;
  groupState: string;
  isExpanded: boolean;
  isEditing: boolean;
  editBody: string;
  onToggle: () => void;
  onMove: (state: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onEditChange: (val: string) => void;
}) {
  const actions = TASK_ACTIONS[groupState];
  return (
    <div className="ml-2 cursor-pointer rounded border-l-2 border-transparent py-0.5 pl-2 text-xs hover:border-accent">
      <div onClick={onToggle}>
        <div className="flex items-center gap-1">
          <span
            className={`font-mono text-[10px] ${task.priority === "p1" ? "text-red-500" : task.priority === "p2" ? "text-yellow-500" : "text-muted-foreground"}`}
          >
            {task.priority}
          </span>
          <span className="flex-1 truncate">{task.title}</span>
          {task.area && (
            <span className="text-[10px] text-muted-foreground">
              {task.area}
            </span>
          )}
        </div>
        {!isExpanded && task.summary && (
          <div className="truncate text-[11px] text-muted-foreground">
            {task.summary}
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="mt-1 space-y-1">
          {isEditing ? (
            <>
              <textarea
                className="w-full rounded border border-input bg-background p-1 text-xs"
                rows={6}
                value={editBody}
                onChange={(e) => onEditChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSave();
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelEdit();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              {task.body && (
                <div
                  className="prose prose-xs dark:prose-invert max-w-none text-xs"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(task.body),
                  }}
                />
              )}
              <div className="flex flex-wrap gap-1">
                {actions?.map((a) => (
                  <Button
                    key={a.state}
                    size="sm"
                    variant={a.danger ? "destructive" : "ghost"}
                    className="h-5 text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(a.state);
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEdit();
                  }}
                >
                  \u270E Edit
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
