/** Memory store browser panel for the KOTA web UI. */

export const CLIENT_MEMORY_JS = `
  // --- Memory panel ---

  var memoryFilter = "";
  var expandedMemory = {};
  var cachedMemory = [];
  var memoryAddFormOpen = false;

  async function refreshMemory() {
    try {
      var res = await apiFetch(API + "/api/memory");
      if (!res.ok) {
        $memoryList.innerHTML = '<div class="run-empty">Failed to load memory</div>';
        return;
      }
      var data = await res.json();
      cachedMemory = data.entries || [];
      renderMemory(cachedMemory, memoryFilter);
    } catch {
      $memoryList.innerHTML = '<div class="run-empty">Failed to load memory</div>';
    }
  }

  async function deleteMemory(id) {
    try {
      var res = await apiFetch(API + "/api/memory/" + encodeURIComponent(id), { method: "DELETE" });
      if (!res.ok) return;
      await refreshMemory();
    } catch { /* ignore */ }
  }

  async function submitAddMemory(content, tags) {
    try {
      var res = await apiFetch(API + "/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content, tags: tags }),
      });
      if (!res.ok) return;
      memoryAddFormOpen = false;
      await refreshMemory();
    } catch { /* ignore */ }
  }

  function renderMemory(entries, filter) {
    $memoryList.innerHTML = "";

    // Add button / inline form
    var addSection = document.createElement("div");
    addSection.style.cssText = "margin-bottom:6px;";
    if (memoryAddFormOpen) {
      var tagsInput = document.createElement("input");
      tagsInput.type = "text";
      tagsInput.placeholder = "Tags (comma-separated)";
      tagsInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:4px;padding:4px 6px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;font-size:12px;";
      var contentInput = document.createElement("textarea");
      contentInput.placeholder = "Memory content";
      contentInput.rows = 3;
      contentInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:4px;padding:4px 6px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;font-size:12px;resize:vertical;";
      var btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:4px;";
      var saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.style.cssText = "flex:1;padding:3px 0;font-size:12px;cursor:pointer;border:1px solid var(--border);background:var(--accent);color:#fff;border-radius:4px;";
      var cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText = "flex:1;padding:3px 0;font-size:12px;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;";
      saveBtn.onclick = function() {
        var content = contentInput.value.trim();
        if (!content) return;
        var tags = tagsInput.value.split(",").map(function(t) { return t.trim(); }).filter(Boolean);
        void submitAddMemory(content, tags);
      };
      cancelBtn.onclick = function() { memoryAddFormOpen = false; renderMemory(cachedMemory, memoryFilter); };
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      addSection.appendChild(tagsInput);
      addSection.appendChild(contentInput);
      addSection.appendChild(btnRow);
    } else {
      var addBtn = document.createElement("button");
      addBtn.textContent = "+ Add Memory";
      addBtn.style.cssText = "width:100%;padding:3px 0;font-size:12px;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;";
      addBtn.onclick = function() { memoryAddFormOpen = true; renderMemory(cachedMemory, memoryFilter); };
      addSection.appendChild(addBtn);
    }
    $memoryList.appendChild(addSection);

    var filtered = filter
      ? entries.filter(function(e) {
          var q = filter.toLowerCase();
          return e.excerpt.toLowerCase().includes(q) ||
            (e.tags || []).some(function(t) { return t.toLowerCase().includes(q); });
        })
      : entries;

    if (!filtered.length) {
      var empty = document.createElement("div");
      empty.className = "run-empty";
      empty.textContent = filter ? "No matching entries" : "No memory entries";
      $memoryList.appendChild(empty);
      return;
    }

    for (var i = 0; i < filtered.length; i++) {
      var entry = filtered[i];
      var isExpanded = !!expandedMemory[entry.id];
      var item = document.createElement("div");
      item.className = "task-item" + (isExpanded ? " expanded" : "");
      item.style.cssText = "position:relative;";

      var tagHtml = (entry.tags || []).length
        ? '<span class="task-item-area">' + escapeHtml(entry.tags.join(", ")) + '</span>'
        : "";
      var header = '<div class="task-item-header" style="padding-right:20px;">' +
        '<span class="task-item-title">' + escapeHtml(entry.id) + '</span>' +
        tagHtml + '</div>';

      var body = "";
      if (isExpanded) {
        body = '<div class="task-item-body knowledge-content">' +
          escapeHtml(entry.excerpt || "") + '</div>';
      } else if (entry.excerpt) {
        body = '<div class="task-item-summary">' + escapeHtml(entry.excerpt.slice(0, 120)) + (entry.excerpt.length > 120 ? "\\u2026" : "") + '</div>';
      }

      item.innerHTML = header + body;

      // Delete button
      var delBtn = document.createElement("button");
      delBtn.textContent = "\\u00d7";
      delBtn.title = "Delete";
      delBtn.style.cssText = "position:absolute;top:4px;right:4px;background:none;border:none;color:var(--fg);opacity:0.5;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;";
      delBtn.onclick = (function(eid) {
        return function(ev) { ev.stopPropagation(); void deleteMemory(eid); };
      })(entry.id);
      item.appendChild(delBtn);

      item.onclick = (function(eid) {
        return function() { expandedMemory[eid] = !expandedMemory[eid]; renderMemory(cachedMemory, memoryFilter); };
      })(entry.id);
      $memoryList.appendChild(item);
    }
  }

  if ($memoryFilter) {
    $memoryFilter.addEventListener("input", function() {
      memoryFilter = $memoryFilter.value;
      renderMemory(cachedMemory, memoryFilter);
    });
  }
`;
