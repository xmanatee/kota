// Task-queue counts and entries as exposed by `GET /tasks`.

import { daemonRequest, type DaemonHttp } from './http';

export interface TaskCounts {
  inbox?: number;
  ready?: number;
  backlog?: number;
  doing?: number;
  blocked?: number;
}

export interface TaskEntry {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
}

export interface TasksResponse {
  counts: TaskCounts;
  tasks: {
    doing?: TaskEntry[];
    ready?: TaskEntry[];
    backlog?: TaskEntry[];
    blocked?: TaskEntry[];
  };
}

export function getTasks(http: DaemonHttp): Promise<TasksResponse> {
  return daemonRequest<TasksResponse>(http, '/tasks');
}
