/** Client-side JavaScript for the KOTA web UI (browser template literal).
 * Assembles section modules into a single IIFE exported as WEB_UI_JS. */

import { CLIENT_ACTIVE_SESSIONS_JS } from "./client-active-sessions.js";
import { CLIENT_APPROVALS_JS } from "./client-approvals.js";
import { CLIENT_AUDIT_JS } from "./client-audit.js";
import { CLIENT_CHAT_JS } from "./client-chat.js";
import { CLIENT_CONFIG_JS } from "./client-config.js";
import { CLIENT_COST_JS } from "./client-cost.js";
import { CLIENT_EXTENSIONS_JS } from "./client-extensions.js";
import { CLIENT_KEYBOARD_JS } from "./client-keyboard.js";
import { CLIENT_KNOWLEDGE_JS } from "./client-knowledge.js";
import { CLIENT_MEMORY_JS } from "./client-memory.js";
import { CLIENT_RUN_DETAIL_JS } from "./client-run-detail.js";
import { CLIENT_RUN_DETAIL_COMPARE_JS } from "./client-run-detail-compare.js";
import { CLIENT_RUN_DETAIL_CONTROLS_JS } from "./client-run-detail-controls.js";
import { CLIENT_RUN_DETAIL_STEPS_JS } from "./client-run-detail-steps.js";
import { CLIENT_RUN_DETAIL_STREAM_JS } from "./client-run-detail-stream.js";
import { CLIENT_SCHEDULES_JS } from "./client-schedules.js";
import { CLIENT_SESSIONS_JS } from "./client-sessions.js";
import { CLIENT_STATUS_OVERVIEW_JS } from "./client-status-overview.js";
import { CLIENT_TASKS_JS } from "./client-tasks.js";
import { CLIENT_THEME_JS } from "./client-theme.js";
import { CLIENT_UTILS_JS } from "./client-utils.js";
import { CLIENT_WF_DEFINITIONS_JS } from "./client-wf-definitions.js";
import { CLIENT_WORKFLOWS_JS } from "./client-workflows.js";

export const WEB_UI_JS = /* js */ `
(function() {
  const API = window.location.origin;
  let sessionId = null;
  let sending = false;
  let activeStream = null;
  let historyViewId = null;
  var expandedTasks = {};
  var collapsedGroups = {};
  var cachedTasks = {};
  var _cachedExtensions = [];

  // Auth token — read from URL param on first load, persist in localStorage
  var _urlToken = new URLSearchParams(window.location.search).get("token");
  if (_urlToken) {
    localStorage.setItem("kota-auth-token", _urlToken);
    history.replaceState(null, "", window.location.pathname);
  }
  var authToken = localStorage.getItem("kota-auth-token") || "";

  function apiFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers);
    if (authToken) options.headers["Authorization"] = "Bearer " + authToken;
    return fetch(url, options);
  }

  const $messages = document.getElementById("messages");
  const $input = document.getElementById("input");
  const $send = document.getElementById("send");
  const $newChat = document.getElementById("new-chat");
  const $sessionList = document.getElementById("session-list");
  const $historyList = document.getElementById("history-list");
  const $approvalList = document.getElementById("approval-list");
  const $activeSessionsList = document.getElementById("active-sessions-list");
  const $taskList = document.getElementById("task-queue-list");
  const $workflowList = document.getElementById("workflow-runs-list");
  const $workflowControls = document.getElementById("workflow-controls");
  const $workflowHistoryFilter = document.getElementById("workflow-history-filter");
  const $costList = document.getElementById("cost-summary-list");
  const $schedulesList = document.getElementById("schedules-list");
  const $wfDefinitionsList = document.getElementById("wf-definitions-list");
  const $extensionsList = document.getElementById("extensions-list");
  const $knowledgeList = document.getElementById("knowledge-list");
  const $knowledgeFilter = document.getElementById("knowledge-filter");
  const $memoryList = document.getElementById("memory-list");
  const $memoryFilter = document.getElementById("memory-filter");
  const $auditList = document.getElementById("audit-list");
  const $auditRiskFilter = document.getElementById("audit-risk-filter");
  const $auditPolicyFilter = document.getElementById("audit-policy-filter");
  const $overviewList = document.getElementById("overview-list");
  const $configList = document.getElementById("config-list");
  const $runDetail = document.getElementById("run-detail");
  const $inputArea = document.getElementById("input-area");
  const $historyViewBar = document.getElementById("history-view-bar");
  const $health = document.getElementById("health-status");
  const $sidebar = document.getElementById("sidebar");
  const $toggleSidebar = document.getElementById("toggle-sidebar");
  const $mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const $sidebarOverlay = document.getElementById("sidebar-overlay");

${CLIENT_UTILS_JS}
${CLIENT_SESSIONS_JS}
${CLIENT_CHAT_JS}
${CLIENT_RUN_DETAIL_CONTROLS_JS}
${CLIENT_RUN_DETAIL_STEPS_JS}
${CLIENT_RUN_DETAIL_STREAM_JS}
${CLIENT_RUN_DETAIL_COMPARE_JS}
${CLIENT_RUN_DETAIL_JS}
${CLIENT_STATUS_OVERVIEW_JS}
${CLIENT_WORKFLOWS_JS}
${CLIENT_TASKS_JS}
${CLIENT_APPROVALS_JS}
${CLIENT_COST_JS}
${CLIENT_ACTIVE_SESSIONS_JS}
${CLIENT_WF_DEFINITIONS_JS}
${CLIENT_SCHEDULES_JS}
${CLIENT_EXTENSIONS_JS}
${CLIENT_KNOWLEDGE_JS}
${CLIENT_MEMORY_JS}
${CLIENT_AUDIT_JS}
${CLIENT_CONFIG_JS}
${CLIENT_THEME_JS}
${CLIENT_KEYBOARD_JS}

  // --- Event listeners ---

  $send.onclick = sendMessage;

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  $input.addEventListener("input", autoResize);

  $newChat.onclick = () => {
    sessionId = null;
    showChat();
    showWelcome();
    refreshSessions();
  };

  function _updateSidebarOverlay() {
    if (!$sidebarOverlay) return;
    $sidebarOverlay.style.display = $sidebar.classList.contains("collapsed") ? "none" : "block";
  }

  $toggleSidebar.onclick = () => {
    $sidebar.classList.toggle("collapsed");
    _updateSidebarOverlay();
  };

  if ($mobileMenuBtn) {
    $mobileMenuBtn.onclick = () => {
      $sidebar.classList.toggle("collapsed");
      _updateSidebarOverlay();
    };
  }

  if ($sidebarOverlay) {
    $sidebarOverlay.onclick = () => {
      $sidebar.classList.add("collapsed");
      _updateSidebarOverlay();
    };
  }

  // --- Init ---
  if (window.innerWidth <= 768) $sidebar.classList.add("collapsed");
  showWelcome();
  checkHealth();
  refreshSessions();
  refreshHistory();
  refreshWorkflows().then(function() { _openRunFromHash(); refreshOverview(); });
  refreshTasks();
  initNewTaskForm();
  refreshCost();
  refreshApprovals();
  refreshActiveSessions();
  refreshWfDefinitions();
  refreshSchedules();
  refreshExtensions();
  refreshKnowledge();
  refreshMemory();
  refreshAudit();
  refreshConfig();
  setInterval(checkHealth, 30000);
  setInterval(refreshSessions, 15000);
  setInterval(refreshOverview, 60000);
  initBrowserNotifications();
  startWorkflowUpdates();
  setInterval(refreshWorkflows, 300000);
  setInterval(refreshTasks, 300000);
  setInterval(refreshCost, 5000);
  setInterval(refreshApprovals, 300000);
  setInterval(refreshActiveSessions, 300000);
  setInterval(refreshWfDefinitions, 300000);
  setInterval(refreshSchedules, 300000);
  $input.focus();
})();
`;
