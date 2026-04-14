/** Run detail control helpers: navigation, abort/retry/replay buttons, and show-more toggles. */

export const CLIENT_RUN_DETAIL_CONTROLS_JS = `
  function scrollToApprovals() {
    var el = document.getElementById('approval-list');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }

  function closeStream() {
    if (activeStream) {
      activeStream.cancel();
      activeStream = null;
    }
  }

  function showChat() {
    closeStream();
    $runDetail.classList.remove("visible");
    $messages.style.display = "";
    $inputArea.style.display = "";
    $historyViewBar.style.display = "none";
    historyViewId = null;
    history.replaceState(null, "", window.location.pathname);
    refreshHistory();
  }

  async function resumeFromStep(runId, stepId, workflowName, btn) {
    btn.disabled = true;
    btn.textContent = "Queueing\\u2026";
    try {
      var r = await apiFetch(API + "/api/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workflowName,
          payload: {
            resumedFromRunId: runId,
            resumeFromStep: stepId,
            resumeTriggeredAt: new Date().toISOString(),
          },
        }),
      });
      var d = await r.json();
      if (r.ok) {
        btn.textContent = "Queued";
      } else {
        btn.textContent = "Error";
        btn.title = d.error || "Trigger failed";
        btn.disabled = false;
      }
    } catch (err) {
      btn.textContent = "Error";
      btn.title = err.message;
      btn.disabled = false;
    }
  }

  function bindRunDetailControls(run) {
    document.getElementById("run-detail-back").onclick = showChat;
    var $abortBtn = document.getElementById("run-detail-abort");
    if ($abortBtn) {
      $abortBtn.onclick = async function() {
        if (!confirm("Abort this run?")) return;
        $abortBtn.disabled = true;
        $abortBtn.textContent = "Aborting\\u2026";
        try {
          await apiFetch(API + "/api/workflow/runs/" + encodeURIComponent(run.id) + "/abort", { method: "POST" });
          showRunDetail(run.id);
        } catch (err) {
          $abortBtn.textContent = "\\u23f9 Abort";
          $abortBtn.disabled = false;
          alert("Abort failed: " + err.message);
        }
      };
    }
    $runDetail.querySelectorAll(".run-causedby-link").forEach(function($link) {
      $link.onclick = function(e) {
        e.preventDefault();
        showRunDetail($link.getAttribute("data-runid"));
      };
    });
    var $replayBtn = document.getElementById("run-detail-replay");
    if ($replayBtn) {
      $replayBtn.onclick = async function() {
        $replayBtn.disabled = true;
        $replayBtn.textContent = "Replaying\\u2026";
        try {
          var res = await apiFetch(API + "/api/workflow/replay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run.id }),
          });
          var data = await res.json();
          if (res.ok && data.ok) {
            $replayBtn.textContent = "\\u2713 Queued";
            if (data.runId) {
              var notice = document.createElement("div");
              notice.style.cssText = "margin-top:8px;font-size:12px;color:var(--text-muted)";
              notice.textContent = "New run: " + data.runId;
              $replayBtn.parentNode.insertBefore(notice, $replayBtn.nextSibling);
            }
          } else {
            $replayBtn.textContent = "\\u21ba Replay";
            $replayBtn.disabled = false;
            alert(data.error || "Replay failed");
          }
        } catch (err) {
          $replayBtn.textContent = "\\u21ba Replay";
          $replayBtn.disabled = false;
          alert("Replay failed: " + err.message);
        }
      };
    }
    var $retryBtn = document.getElementById("run-detail-retry");
    if ($retryBtn) {
      $retryBtn.onclick = async function() {
        $retryBtn.disabled = true;
        try {
          var retryRes = await apiFetch(API + "/api/workflow/retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run.id }),
          });
          if (!retryRes.ok) {
            var retryErr = await retryRes.json();
            $retryBtn.title = retryErr.error || "Error";
          } else {
            $retryBtn.textContent = "Queued!";
          }
          await refreshWorkflows();
        } finally {
          $retryBtn.disabled = false;
        }
      };
    }
    var $logSearch = document.getElementById("log-search-input");
    if ($logSearch) {
      $logSearch.addEventListener("input", function() {
        applyLogSearch($logSearch.value);
      });
      $logSearch.addEventListener("keydown", function(e) {
        if (e.key === "Escape") { $logSearch.value = ""; applyLogSearch(""); }
      });
    }
    $runDetail.querySelectorAll(".step-show-more").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var stepId = btn.getAttribute("data-step");
        var outputEl = document.getElementById("step-output-" + stepId);
        if (!outputEl) return;
        if (outputEl.getAttribute("data-truncated") === "1") {
          outputEl.textContent = outputEl.getAttribute("data-full") || "";
          outputEl.setAttribute("data-truncated", "0");
          btn.textContent = "Show less";
        } else {
          var full = outputEl.getAttribute("data-full") || "";
          outputEl.textContent = full.slice(0, 300) + (full.length > 300 ? "\\u2026" : "");
          outputEl.setAttribute("data-truncated", "1");
          btn.textContent = "Show more";
        }
      });
    });
  }
`;
