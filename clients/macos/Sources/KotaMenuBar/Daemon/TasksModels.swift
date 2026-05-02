import Foundation

// Task-queue counts and entries as exposed by `GET /tasks`.

struct TaskQueueResponse: Codable {
    let counts: TaskQueueCounts
    let tasks: TaskQueueTasks
}

struct TaskQueueCounts: Codable {
    let inbox: Int
    let ready: Int
    let backlog: Int
    let doing: Int
    let blocked: Int
}

struct TaskQueueTasks: Codable {
    let doing: [TaskDetail]
    let ready: [TaskDetail]
}

struct TaskDetail: Codable, Identifiable {
    let id: String
    let title: String
    let priority: String
    let area: String
    let summary: String
}
