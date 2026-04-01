/** Knowledge store browser panel for the KOTA web UI. */

export const CLIENT_KNOWLEDGE_JS = `
  // --- Knowledge panel ---

  var knowledgeFilter = "";
  var expandedKnowledge = {};
  var cachedKnowledge = [];
  var knowledgeAddFormOpen = false;

  async function refreshKnowledge() {
    try {
      var res = await apiFetch(API + "/api/knowledge");
      if (!res.ok) {
        $knowledgeList.innerHTML = '<div class="run-empty">Failed to load knowledge</div>';
        return;
      }
      var data = await res.json();
      cachedKnowledge = data.entries || [];
      renderKnowledge(cachedKnowledge, knowledgeFilter);
    } catch {
      $knowledgeList.innerHTML = '<div class="run-empty">Failed to load knowledge</div>';
    }
  }

  async function deleteKnowledge(id) {
    try {
      var res = await apiFetch(API + "/api/knowledge/" + encodeURIComponent(id), { method: "DELETE" });
      if (!res.ok) return;
      await refreshKnowledge();
    } catch { /* ignore */ }
  }

  async function submitAddKnowledge(title, content, type, tags) {
    try {
      var res = await apiFetch(API + "/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title, content: content, type: type, tags: tags }),
      });
      if (!res.ok) return;
      knowledgeAddFormOpen = false;
      await refreshKnowledge();
    } catch { /* ignore */ }
  }

  function renderKnowledge(entries, filter) {
    $knowledgeList.innerHTML = "";

    // Add button / inline form
    var addSection = document.createElement("div");
    addSection.style.cssText = "margin-bottom:6px;";
    if (knowledgeAddFormOpen) {
      var titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.placeholder = "Title (required)";
      titleInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:4px;padding:4px 6px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;font-size:12px;";
      var typeInput = document.createElement("input");
      typeInput.type = "text";
      typeInput.placeholder = "Type (default: note)";
      typeInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:4px;padding:4px 6px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;font-size:12px;";
      var tagsInput = document.createElement("input");
      tagsInput.type = "text";
      tagsInput.placeholder = "Tags (comma-separated)";
      tagsInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:4px;padding:4px 6px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;font-size:12px;";
      var contentInput = document.createElement("textarea");
      contentInput.placeholder = "Content";
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
        var title = titleInput.value.trim();
        if (!title) return;
        var type = typeInput.value.trim() || "note";
        var tags = tagsInput.value.split(",").map(function(t) { return t.trim(); }).filter(Boolean);
        var content = contentInput.value;
        void submitAddKnowledge(title, content, type, tags);
      };
      cancelBtn.onclick = function() { knowledgeAddFormOpen = false; renderKnowledge(cachedKnowledge, knowledgeFilter); };
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      addSection.appendChild(titleInput);
      addSection.appendChild(typeInput);
      addSection.appendChild(tagsInput);
      addSection.appendChild(contentInput);
      addSection.appendChild(btnRow);
    } else {
      var addBtn = document.createElement("button");
      addBtn.textContent = "+ Add Knowledge";
      addBtn.style.cssText = "width:100%;padding:3px 0;font-size:12px;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:4px;";
      addBtn.onclick = function() { knowledgeAddFormOpen = true; renderKnowledge(cachedKnowledge, knowledgeFilter); };
      addSection.appendChild(addBtn);
    }
    $knowledgeList.appendChild(addSection);

    var filtered = filter
      ? entries.filter(function(e) {
          var q = filter.toLowerCase();
          return e.title.toLowerCase().includes(q) ||
            e.excerpt.toLowerCase().includes(q) ||
            (e.tags || []).some(function(t) { return t.toLowerCase().includes(q); });
        })
      : entries;

    if (!filtered.length) {
      var empty = document.createElement("div");
      empty.className = "run-empty";
      empty.textContent = filter ? "No matching entries" : "No knowledge entries";
      $knowledgeList.appendChild(empty);
      return;
    }

    for (var i = 0; i < filtered.length; i++) {
      var entry = filtered[i];
      var isExpanded = !!expandedKnowledge[entry.id];
      var item = document.createElement("div");
      item.className = "task-item" + (isExpanded ? " expanded" : "");
      item.style.cssText = "position:relative;";

      var header = '<div class="task-item-header" style="padding-right:20px;">' +
        '<span class="task-item-title">' + escapeHtml(entry.title) + '</span>';
      if (entry.type) header += '<span class="task-item-area">' + escapeHtml(entry.type) + '</span>';
      header += '</div>';

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
        return function(ev) { ev.stopPropagation(); void deleteKnowledge(eid); };
      })(entry.id);
      item.appendChild(delBtn);

      item.onclick = (function(eid) {
        return function() { expandedKnowledge[eid] = !expandedKnowledge[eid]; renderKnowledge(cachedKnowledge, knowledgeFilter); };
      })(entry.id);
      $knowledgeList.appendChild(item);
    }
  }

  if ($knowledgeFilter) {
    $knowledgeFilter.addEventListener("input", function() {
      knowledgeFilter = $knowledgeFilter.value;
      renderKnowledge(cachedKnowledge, knowledgeFilter);
    });
  }
`;
