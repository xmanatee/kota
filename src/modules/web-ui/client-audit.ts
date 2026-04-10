/** Guardrail audit trail panel for the KOTA web UI. */

export const CLIENT_AUDIT_JS = `
  // --- Guardrail audit panel ---

  var auditRiskFilter = "";
  var auditPolicyFilter = "";
  var expandedAudit = {};
  var cachedAudit = [];

  function buildAuditUrl() {
    var params = new URLSearchParams();
    params.set("limit", "200");
    if (auditRiskFilter) params.set("risk", auditRiskFilter);
    if (auditPolicyFilter) params.set("policy", auditPolicyFilter);
    return API + "/api/audit?" + params.toString();
  }

  async function refreshAudit() {
    try {
      var res = await apiFetch(buildAuditUrl());
      if (!res.ok) {
        $auditList.innerHTML = '<div class="run-empty">Failed to load audit trail</div>';
        return;
      }
      var data = await res.json();
      cachedAudit = data.entries || [];
      renderAudit(cachedAudit);
    } catch {
      $auditList.innerHTML = '<div class="run-empty">Failed to load audit trail</div>';
    }
  }

  function renderAudit(entries) {
    $auditList.innerHTML = "";
    if (!entries.length) {
      $auditList.innerHTML = '<div class="run-empty">No audit entries</div>';
      return;
    }

    var riskColors = { safe: "#4caf50", moderate: "#ff9800", dangerous: "#f44336" };
    var policyColors = { allow: "#4caf50", confirm: "#ff9800", deny: "#f44336", queue: "#2196f3" };

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var isExpanded = !!expandedAudit[i];
      var item = document.createElement("div");
      item.className = "task-item" + (isExpanded ? " expanded" : "");

      var riskColor = riskColors[entry.risk] || "#888";
      var policyColor = policyColors[entry.policy] || "#888";

      var header = '<div class="task-item-header">' +
        '<span class="task-item-title">' + escapeHtml(entry.tool) + '</span>' +
        '<span class="task-item-area" style="color:' + riskColor + '">' + escapeHtml(entry.risk) + '</span>' +
        '<span class="task-item-area" style="color:' + policyColor + '">' + escapeHtml(entry.policy) + '</span>' +
        '</div>';

      var ts = entry.ts ? new Date(entry.ts).toLocaleString() : "";
      var summary = '<div class="task-item-summary">' + escapeHtml(entry.reason.slice(0, 100)) +
        (entry.reason.length > 100 ? "\\u2026" : "") + '</div>';

      var body = "";
      if (isExpanded) {
        body = '<div class="task-item-body">' +
          '<div><strong>Reason:</strong> ' + escapeHtml(entry.reason) + '</div>' +
          (entry.session ? '<div><strong>Session:</strong> ' + escapeHtml(entry.session) + '</div>' : '') +
          '<div><strong>Time:</strong> ' + escapeHtml(ts) + '</div>' +
          '</div>';
      } else {
        body = summary;
      }

      item.innerHTML = header + body;
      item.onclick = (function(idx) {
        return function() { expandedAudit[idx] = !expandedAudit[idx]; renderAudit(cachedAudit); };
      })(i);
      $auditList.appendChild(item);
    }
  }

  if ($auditRiskFilter) {
    $auditRiskFilter.addEventListener("change", function() {
      auditRiskFilter = $auditRiskFilter.value;
      void refreshAudit();
    });
  }

  if ($auditPolicyFilter) {
    $auditPolicyFilter.addEventListener("change", function() {
      auditPolicyFilter = $auditPolicyFilter.value;
      void refreshAudit();
    });
  }
`;
