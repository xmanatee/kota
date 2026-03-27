/** Approval panel functions for the KOTA web UI. */

export const CLIENT_APPROVALS_JS = `
  // --- Approval panel ---

  function renderApprovals(approvals) {
    $approvalList.innerHTML = "";
    if (!approvals.length) {
      $approvalList.innerHTML = '<div class="run-empty">No pending approvals</div>';
      return;
    }
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
        '<div class="approval-actions">' +
        '<button class="approval-btn approval-approve" data-id="' + escapeHtml(a.id) + '">\u2713 Approve</button>' +
        '<button class="approval-btn approval-reject" data-id="' + escapeHtml(a.id) + '">\u2717 Reject</button>' +
        '</div>';
      $approvalList.appendChild(item);
    }
    var approveBtns = $approvalList.querySelectorAll(".approval-approve");
    var rejectBtns = $approvalList.querySelectorAll(".approval-reject");
    for (var j = 0; j < approveBtns.length; j++) {
      (function(btn) {
        btn.onclick = async function() {
          btn.disabled = true;
          try {
            await fetch(API + "/api/approvals/" + encodeURIComponent(btn.dataset.id) + "/approve", { method: "POST" });
            refreshApprovals();
          } catch { btn.disabled = false; }
        };
      })(approveBtns[j]);
    }
    for (var k = 0; k < rejectBtns.length; k++) {
      (function(btn) {
        btn.onclick = async function() {
          btn.disabled = true;
          try {
            await fetch(API + "/api/approvals/" + encodeURIComponent(btn.dataset.id) + "/reject", { method: "POST" });
            refreshApprovals();
          } catch { btn.disabled = false; }
        };
      })(rejectBtns[k]);
    }
  }

  async function refreshApprovals() {
    try {
      var res = await fetch(API + "/api/approvals");
      if (!res.ok) return;
      var data = await res.json();
      renderApprovals(data.approvals || []);
    } catch {}
  }
`;
