/** Memory store browser panel for the KOTA web UI. */

export const CLIENT_MEMORY_JS = `
  // --- Memory panel ---

  var memoryFilter = "";
  var expandedMemory = {};
  var cachedMemory = [];

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

  function renderMemory(entries, filter) {
    $memoryList.innerHTML = "";
    var filtered = filter
      ? entries.filter(function(e) {
          var q = filter.toLowerCase();
          return e.excerpt.toLowerCase().includes(q) ||
            (e.tags || []).some(function(t) { return t.toLowerCase().includes(q); });
        })
      : entries;

    if (!filtered.length) {
      $memoryList.innerHTML = '<div class="run-empty">' +
        (filter ? "No matching entries" : "No memory entries") + '</div>';
      return;
    }

    for (var i = 0; i < filtered.length; i++) {
      var entry = filtered[i];
      var isExpanded = !!expandedMemory[entry.id];
      var item = document.createElement("div");
      item.className = "task-item" + (isExpanded ? " expanded" : "");

      var tagHtml = (entry.tags || []).length
        ? '<span class="task-item-area">' + escapeHtml(entry.tags.join(", ")) + '</span>'
        : "";
      var header = '<div class="task-item-header">' +
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
