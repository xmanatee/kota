/** Task queue panel functions for the KOTA web UI. */

export const CLIENT_TASKS_JS = `
  // --- Task queue panel ---

  var TASK_GROUPS = [
    { state: "doing", label: "Doing", badgeClass: "running", icon: "\\u25b6" },
    { state: "ready", label: "Ready", badgeClass: "success", icon: "\\u25cb" },
    { state: "blocked", label: "Blocked", badgeClass: "interrupted", icon: "\\u26a1" },
    { state: "backlog", label: "Backlog", badgeClass: "pending", icon: "\\u00b7" },
  ];

  function renderTasks(tasks) {
    $taskList.innerHTML = "";
    var anyTasks = false;

    for (var g = 0; g < TASK_GROUPS.length; g++) {
      var group = TASK_GROUPS[g];
      var items = (tasks && tasks[group.state]) || [];
      if (!items.length) continue;
      anyTasks = true;

      var isCollapsed = !!collapsedGroups[group.state];
      var header = document.createElement("div");
      header.className = "task-group-header";
      header.innerHTML =
        '<span class="run-badge ' + group.badgeClass + '">' + group.icon + '</span>' +
        '<span class="task-group-label">' + group.label + '</span>' +
        '<span class="task-group-count">' + items.length + '</span>' +
        '<span class="task-group-toggle">' + (isCollapsed ? "\\u25b8" : "\\u25be") + '</span>';
      header.onclick = (function(state) {
        return function() { collapsedGroups[state] = !collapsedGroups[state]; renderTasks(cachedTasks); };
      })(group.state);
      $taskList.appendChild(header);

      if (isCollapsed) continue;

      for (var i = 0; i < items.length; i++) {
        var t = items[i];
        var tid = t.id;
        var isExpanded = !!expandedTasks[tid];
        var item = document.createElement("div");
        item.className = "task-item" + (isExpanded ? " expanded" : "");

        var html = '<div class="task-item-header">' +
          '<span class="task-priority task-priority-' + escapeHtml(t.priority || "p3") + '">' + escapeHtml(t.priority || "") + '</span>' +
          '<span class="task-item-title">' + escapeHtml(t.title) + '</span>';
        if (t.area) html += '<span class="task-item-area">' + escapeHtml(t.area) + '</span>';
        html += '</div>';

        if (!isExpanded && t.summary) {
          html += '<div class="task-item-summary">' + escapeHtml(t.summary) + '</div>';
        }
        if (isExpanded && t.body) {
          html += '<div class="task-item-body">' + renderMarkdown(t.body) + '</div>';
        }

        item.innerHTML = html;
        item.onclick = (function(taskId) {
          return function() { expandedTasks[taskId] = !expandedTasks[taskId]; renderTasks(cachedTasks); };
        })(tid);
        $taskList.appendChild(item);
      }
    }

    if (!anyTasks) {
      $taskList.innerHTML = '<div class="run-empty">No open tasks</div>';
    }
  }

  async function refreshTasks() {
    try {
      var res = await apiFetch(API +"/api/tasks");
      if (!res.ok) return;
      var data = await res.json();
      cachedTasks = data.tasks || {};
      renderTasks(cachedTasks);
    } catch {}
  }
`;
