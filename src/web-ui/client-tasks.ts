/** Task queue panel functions for the KOTA web UI. */

export const CLIENT_TASKS_JS = `
  // --- Task queue panel ---

  var TASK_GROUPS = [
    { state: "doing", label: "Doing", badgeClass: "running", icon: "\\u25b6" },
    { state: "ready", label: "Ready", badgeClass: "success", icon: "\\u25cb" },
    { state: "blocked", label: "Blocked", badgeClass: "interrupted", icon: "\\u26a1" },
    { state: "backlog", label: "Backlog", badgeClass: "pending", icon: "\\u00b7" },
  ];

  var TASK_ACTIONS = {
    ready:   [{ label: "\\u2193 Backlog", state: "backlog" }, { label: "\\u2715 Drop", state: "dropped", danger: true }],
    backlog: [{ label: "\\u2191 Ready",   state: "ready"   }, { label: "\\u2715 Drop", state: "dropped", danger: true }],
    blocked: [{ label: "\\u2191 Ready",   state: "ready"   }, { label: "\\u2193 Backlog", state: "backlog" }, { label: "\\u2715 Drop", state: "dropped", danger: true }],
  };

  var editingTasks = {};
  var taskNotice = "";

  function setTaskNotice(message) {
    taskNotice = message;
  }

  async function moveTaskState(id, newState) {
    try {
      var res = await apiFetch(API + "/api/tasks/" + encodeURIComponent(id) + "/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: newState }),
      });
      if (!res.ok) {
        setTaskNotice("Failed to update task state");
        renderTasks(cachedTasks);
        return;
      }
      setTaskNotice("");
      refreshTasks();
    } catch {
      setTaskNotice("Failed to update task state");
      renderTasks(cachedTasks);
    }
  }

  async function saveTaskBody(id, bodyText) {
    try {
      var res = await apiFetch(API + "/api/tasks/" + encodeURIComponent(id) + "/body", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: bodyText }),
      });
      if (res.ok) {
        var data = await res.json();
        for (var state in cachedTasks) {
          var items = cachedTasks[state];
          for (var i = 0; i < items.length; i++) {
            if (items[i].id === id) { items[i].body = data.body; break; }
          }
        }
        editingTasks[id] = false;
        setTaskNotice("");
        renderTasks(cachedTasks);
        return;
      }
      setTaskNotice("Failed to save task changes");
      renderTasks(cachedTasks);
    } catch {
      setTaskNotice("Failed to save task changes");
      renderTasks(cachedTasks);
    }
  }

  function renderTaskActions(state, taskId, isExpanded) {
    var actions = TASK_ACTIONS[state];
    if (!actions && !isExpanded) return "";
    var html = '<span class="task-item-actions">';
    if (actions) {
      for (var a = 0; a < actions.length; a++) {
        var act = actions[a];
        html += '<button class="task-action-btn' + (act.danger ? " danger" : "") + '" data-task-id="' + escapeHtml(taskId) + '" data-state="' + escapeHtml(act.state) + '">' + act.label + '</button>';
      }
    }
    if (isExpanded) {
      html += '<button class="task-edit-btn task-action-btn" data-task-id="' + escapeHtml(taskId) + '">\u270e Edit</button>';
    }
    html += '</span>';
    return html;
  }

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
        var isEditing = isExpanded && !!editingTasks[tid];
        var item = document.createElement("div");
        item.className = "task-item" + (isExpanded ? " expanded" : "");

        var html = '<div class="task-item-header">' +
          '<span class="task-priority task-priority-' + escapeHtml(t.priority || "p3") + '">' + escapeHtml(t.priority || "") + '</span>' +
          '<span class="task-item-title">' + escapeHtml(t.title) + '</span>';
        if (t.area) html += '<span class="task-item-area">' + escapeHtml(t.area) + '</span>';
        html += renderTaskActions(group.state, tid, isExpanded);
        html += '</div>';

        if (!isExpanded && t.summary) {
          html += '<div class="task-item-summary">' + escapeHtml(t.summary) + '</div>';
        }
        if (isEditing) {
          html += '<textarea class="task-edit-textarea" data-task-id="' + escapeHtml(tid) + '">' + escapeHtml(t.body || '') + '</textarea>';
          html += '<div class="task-edit-actions">' +
            '<button class="task-edit-save-btn task-action-btn" data-task-id="' + escapeHtml(tid) + '">Save</button>' +
            '<button class="task-edit-cancel-btn task-action-btn" data-task-id="' + escapeHtml(tid) + '">Cancel</button>' +
            '</div>';
        } else if (isExpanded && t.body) {
          html += '<div class="task-item-body">' + renderMarkdown(t.body) + '</div>';
        }

        item.innerHTML = html;
        item.onclick = (function(taskId) {
          return function(e) {
            if (e.target && e.target.classList && (
              e.target.classList.contains("task-action-btn") ||
              e.target.classList.contains("task-edit-textarea")
            )) return;
            expandedTasks[taskId] = !expandedTasks[taskId];
            if (!expandedTasks[taskId]) editingTasks[taskId] = false;
            renderTasks(cachedTasks);
          };
        })(tid);
        $taskList.appendChild(item);
      }
    }

    // Wire up state action buttons
    var btns = $taskList.querySelectorAll(".task-action-btn[data-state]");
    for (var b = 0; b < btns.length; b++) {
      (function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          moveTaskState(btn.getAttribute("data-task-id"), btn.getAttribute("data-state"));
        };
      })(btns[b]);
    }

    // Wire up edit buttons
    var editBtns = $taskList.querySelectorAll(".task-edit-btn");
    for (var eb = 0; eb < editBtns.length; eb++) {
      (function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          editingTasks[btn.getAttribute("data-task-id")] = true;
          renderTasks(cachedTasks);
        };
      })(editBtns[eb]);
    }

    // Wire up save buttons
    var saveBtns = $taskList.querySelectorAll(".task-edit-save-btn");
    for (var sb = 0; sb < saveBtns.length; sb++) {
      (function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          var taskId = btn.getAttribute("data-task-id");
          var textarea = $taskList.querySelector(".task-edit-textarea[data-task-id='" + taskId + "']");
          saveTaskBody(taskId, textarea ? textarea.value : "");
        };
      })(saveBtns[sb]);
    }

    // Wire up cancel buttons
    var cancelBtns = $taskList.querySelectorAll(".task-edit-cancel-btn");
    for (var cb = 0; cb < cancelBtns.length; cb++) {
      (function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          editingTasks[btn.getAttribute("data-task-id")] = false;
          renderTasks(cachedTasks);
        };
      })(cancelBtns[cb]);
    }

    if (taskNotice) {
      var notice = document.createElement("div");
      notice.className = "run-empty";
      notice.textContent = taskNotice;
      $taskList.appendChild(notice);
    }

    if (!anyTasks) {
      $taskList.innerHTML = '<div class="run-empty">No open tasks</div>';
    }
  }

  async function refreshTasks() {
    try {
      var res = await apiFetch(API +"/api/tasks");
      if (!res.ok) {
        setTaskNotice("Failed to load tasks");
        $taskList.innerHTML = '<div class="run-empty">Failed to load tasks</div>';
        return;
      }
      var data = await res.json();
      setTaskNotice("");
      cachedTasks = data.tasks || {};
      renderTasks(cachedTasks);
    } catch {
      setTaskNotice("Failed to load tasks");
      $taskList.innerHTML = '<div class="run-empty">Failed to load tasks</div>';
    }
  }

  function initNewTaskForm() {
    var $form = document.getElementById("new-task-form");
    if (!$form) return;
    $form.onsubmit = async function(e) {
      e.preventDefault();
      var titleEl = document.getElementById("new-task-title");
      var summaryEl = document.getElementById("new-task-summary");
      var title = titleEl ? titleEl.value.trim() : "";
      if (!title) return;
      try {
        var res = await apiFetch(API + "/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title, summary: summaryEl ? summaryEl.value.trim() : "" }),
      });
      if (res.ok) {
        if (titleEl) titleEl.value = "";
        if (summaryEl) summaryEl.value = "";
        setTaskNotice("");
        refreshTasks();
        return;
      }
        setTaskNotice("Failed to create task");
        renderTasks(cachedTasks);
      } catch {
        setTaskNotice("Failed to create task");
        renderTasks(cachedTasks);
      }
    };
  }
`;
