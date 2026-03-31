/** Knowledge store browser panel for the KOTA web UI. */

export const CLIENT_KNOWLEDGE_JS = `
  // --- Knowledge panel ---

  var knowledgeFilter = "";
  var expandedKnowledge = {};
  var cachedKnowledge = [];

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

  function renderKnowledge(entries, filter) {
    $knowledgeList.innerHTML = "";
    var filtered = filter
      ? entries.filter(function(e) {
          var q = filter.toLowerCase();
          return e.title.toLowerCase().includes(q) ||
            e.excerpt.toLowerCase().includes(q) ||
            (e.tags || []).some(function(t) { return t.toLowerCase().includes(q); });
        })
      : entries;

    if (!filtered.length) {
      $knowledgeList.innerHTML = '<div class="run-empty">' +
        (filter ? "No matching entries" : "No knowledge entries") + '</div>';
      return;
    }

    for (var i = 0; i < filtered.length; i++) {
      var entry = filtered[i];
      var isExpanded = !!expandedKnowledge[entry.id];
      var item = document.createElement("div");
      item.className = "task-item" + (isExpanded ? " expanded" : "");

      var header = '<div class="task-item-header">' +
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
