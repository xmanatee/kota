// Task-queue counts and entries as exposed by `GET /tasks`.

import { daemonRequest, type DaemonHttp } from './http';

export interface TaskCounts {
  inbox?: number;
  open?: number;
  blocked?: number;
}

export interface TaskEntry {
  id: string;
  title: string;
  priority: string;
  body: string;
  waitingOnTasks: string[];
  inProgress: boolean;
}

export interface TasksResponse {
  counts: TaskCounts;
  tasks: {
    open?: TaskEntry[];
    blocked?: TaskEntry[];
  };
}

export function getTasks(http: DaemonHttp): Promise<TasksResponse> {
  return daemonRequest<TasksResponse>(http, '/api/tasks');
}
