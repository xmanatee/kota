/** Approval panel functions for the KOTA web UI. */

export const CLIENT_APPROVALS_JS = `
  // --- Approval panel ---

  var approvalsNotice = "";

  function setApprovalsNotice(message) {
    approvalsNotice = message;
  }

  function renderApprovals(approvals) {
    $approvalList.innerHTML = "";
    if (approvalsNotice) {
      $approvalList.innerHTML = '<div class="run-empty">' + escapeHtml(approvalsNotice) + '</div>';
      return;
    }
    if (!approvals.length) {
      $approvalList.innerHTML = '<div class="run-empty">No pending approvals</div>';
      return;
    }

    var bulkBar = document.createElement("div");
    bulkBar.className = "approval-bulk-bar";
    bulkBar.innerHTML =
      '<button class="approval-btn approval-approve approval-bulk-approve">Approve all (' + approvals.length + ')</button>' +
      '<button class="approval-btn approval-reject approval-bulk-reject">Reject all (' + approvals.length + ')</button>';
    $approvalList.appendChild(bulkBar);

    var bulkApproveBtn = bulkBar.querySelector(".approval-bulk-approve");
    var bulkRejectBtn = bulkBar.querySelector(".approval-bulk-reject");

    bulkApproveBtn.onclick = async function() {
      if (bulkApproveBtn.dataset.confirming) {
        bulkApproveBtn.disabled = true;
        bulkRejectBtn.disabled = true;
        try {
          var res = await apiFetch(API + "/api/approvals/approve-all", { method: "POST" });
          if (!res.ok) { setApprovalsNotice("Failed to approve all"); renderApprovals(approvals); return; }
          setApprovalsNotice("");
          refreshApprovals();
        } catch {
          setApprovalsNotice("Failed to approve all");
          renderApprovals(approvals);
        }
      } else {
        bulkApproveBtn.dataset.confirming = "1";
        bulkApproveBtn.textContent = "Confirm approve " + approvals.length + "?";
      }
    };

    bulkRejectBtn.onclick = async function() {
      if (bulkRejectBtn.dataset.confirming) {
        bulkApproveBtn.disabled = true;
        bulkRejectBtn.disabled = true;
        try {
          var res = await apiFetch(API + "/api/approvals/reject-all", { method: "POST" });
          if (!res.ok) { setApprovalsNotice("Failed to reject all"); renderApprovals(approvals); return; }
          setApprovalsNotice("");
          refreshApprovals();
        } catch {
          setApprovalsNotice("Failed to reject all");
          renderApprovals(approvals);
        }
      } else {
        bulkRejectBtn.dataset.confirming = "1";
        bulkRejectBtn.textContent = "Confirm reject " + approvals.length + "?";
      }
    };

    for (var i = 0; i < approvals.length; i++) {
      var a = approvals[i];
      var ageMs = Date.now() - new Date(a.createdAt).getTime();
      var item = document.createElement("div");
      item.className = "approval-item";
      item.innerHTML =
        '<div class="approval-header">' +
        '<span class="approval-risk ' + escapeHtml(a.risk) + '">' + escapeHtml(a.risk) + '</span>' +
        '<span class="approval-tool">' + escapeHtml(a.tool) + '</span>' +
        '<span class="run-meta">' + fmtDuration(ageMs) + '</span>' +
        '</div>' +
        '<div class="approval-reason">' + escapeHtml(a.reason) + '</div>' +
        (function() {
          if (!a.input) return '';
          var inputJson = JSON.stringify(a.input, null, 2);
          var truncated = inputJson.length > 2048;
          var displayJson = truncated ? inputJson.slice(0, 2048) : inputJson;
          return '<details class="approval-input">' +
            '<summary class="approval-input-toggle">Input</summary>' +
            '<pre class="approval-input-pre"' + (truncated ? ' data-full="' + escapeHtml(inputJson) + '"' : '') + '>' + escapeHtml(displayJson) + (truncated ? '\n\u2026 (truncated)' : '') + '</pre>' +
            (truncated ? '<button class="approval-input-full" onclick="var p=this.previousElementSibling;p.textContent=p.dataset.full;this.remove()">Show full input</button>' : '') +
            '</details>';
        })() +
        (a.context ? '<details class="approval-context"><summary class="approval-input-toggle">Why?</summary><pre class="approval-input-pre">' + escapeHtml(a.context) + '</pre></details>' : '') +
        '<div class="approval-actions">' +
        '<button class="approval-btn approval-approve" data-id="' + escapeHtml(a.id) + '">\u2713 Approve</button>' +
        '<button class="approval-btn approval-reject" data-id="' + escapeHtml(a.id) + '">\u2717 Reject</button>' +
        '</div>';
      $approvalList.appendChild(item);
    }
    var approveBtns = $approvalList.querySelectorAll(".approval-item .approval-approve");
    var rejectBtns = $approvalList.querySelectorAll(".approval-item .approval-reject");
    for (var j = 0; j < approveBtns.length; j++) {
      (function(btn) {
        btn.onclick = async function() {
          var note = window.prompt("Optional note for this approval (leave blank to skip):") || undefined;
          btn.disabled = true;
          try {
            var res = await apiFetch(API +"/api/approvals/" + encodeURIComponent(btn.dataset.id) + "/approve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ note: note }),
            });
            if (!res.ok) {
              setApprovalsNotice("Failed to approve request");
              renderApprovals(approvals);
              btn.disabled = false;
              return;
            }
            setApprovalsNotice("");
            refreshApprovals();
          } catch {
            setApprovalsNotice("Failed to approve request");
            renderApprovals(approvals);
            btn.disabled = false;
          }
        };
      })(approveBtns[j]);
    }
    for (var k = 0; k < rejectBtns.length; k++) {
      (function(btn) {
        btn.onclick = async function() {
          btn.disabled = true;
          try {
            var res = await apiFetch(API +"/api/approvals/" + encodeURIComponent(btn.dataset.id) + "/reject", { method: "POST" });
            if (!res.ok) {
              setApprovalsNotice("Failed to reject request");
              renderApprovals(approvals);
              btn.disabled = false;
              return;
            }
            setApprovalsNotice("");
            refreshApprovals();
          } catch {
            setApprovalsNotice("Failed to reject request");
            renderApprovals(approvals);
            btn.disabled = false;
          }
        };
      })(rejectBtns[k]);
    }
  }

  async function refreshApprovals() {
    try {
      var res = await apiFetch(API +"/api/approvals");
      if (!res.ok) {
        setApprovalsNotice("Failed to load approvals");
        renderApprovals([]);
        return;
      }
      var data = await res.json();
      setApprovalsNotice("");
      renderApprovals(data.approvals || []);
    } catch {
      setApprovalsNotice("Failed to load approvals");
      renderApprovals([]);
    }
  }
`;
