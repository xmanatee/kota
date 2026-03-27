export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "pending" | "in_progress" | "done";

export type Task = {
  id: number;
  task: string;
  status: TaskStatus;
  parent_id?: number;
  priority?: TaskPriority;
  blocked_by?: number[];
  created: string;
  completed?: string;
  notes?: string;
};

export type TaskFileData = {
  project: string;
  tasks: Task[];
  nextId: number;
};
