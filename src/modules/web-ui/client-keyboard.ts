/** Keyboard navigation shortcuts for the KOTA web UI run history list. */

export const CLIENT_KEYBOARD_JS = `
  // --- Keyboard navigation ---

  function _isInputFocused() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  function _getSelectableRunItems() {
    return Array.from($workflowList.querySelectorAll("[data-run-id]"));
  }

  function _getCurrentSelectedIndex() {
    var items = _getSelectableRunItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains("run-item-selected")) return i;
    }
    return -1;
  }

  function _setSelectedRunIndex(idx) {
    var items = _getSelectableRunItems();
    items.forEach(function(item) { item.classList.remove("run-item-selected"); });
    if (idx < 0 || idx >= items.length) return;
    items[idx].classList.add("run-item-selected");
    items[idx].scrollIntoView({ block: "nearest" });
    var runId = items[idx].getAttribute("data-run-id");
    if (runId) showRunDetail(runId);
  }

  document.addEventListener("keydown", function(e) {
    if (_isInputFocused()) return;
    if (e.key === "j" || e.key === "k") {
      var items = _getSelectableRunItems();
      if (items.length === 0) return;
      e.preventDefault();
      var cur = _getCurrentSelectedIndex();
      var next = e.key === "j"
        ? (cur < items.length - 1 ? cur + 1 : 0)
        : (cur > 0 ? cur - 1 : items.length - 1);
      _setSelectedRunIndex(next);
    } else if (e.key === "Escape") {
      if ($runDetail.classList.contains("visible")) {
        _getSelectableRunItems().forEach(function(item) { item.classList.remove("run-item-selected"); });
        showChat();
      }
    } else if (e.key === "/") {
      if ($runDetail.classList.contains("visible")) {
        var logSearch = document.getElementById("log-search-input");
        if (logSearch) {
          e.preventDefault();
          logSearch.focus();
        }
      }
    }
  });
`;
